import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Budget } from '../database/entities/budget.entity';
import { Expense } from '../database/entities/expense.entity';
import { UpsertBudgetDto } from './dto/upsert-budget.dto';
import { CategoriesService } from '../categories/categories.service';
import { resolveLegacyCategory, SYSTEM_BY_ID } from '../categories/category-resolver';
import { LEGACY_CATEGORY_MAP } from '../categories/taxonomy.generated';

@Injectable()
export class BudgetsService {
  constructor(
    @InjectRepository(Budget)
    private readonly budgetsRepository: Repository<Budget>,
    @InjectRepository(Expense)
    private readonly expensesRepository: Repository<Expense>,
    private readonly categoriesService: CategoriesService,
  ) {}

  async findAll(userId: string, month: string): Promise<Budget[]> {
    return this.budgetsRepository.find({
      where: { userId, month, isDeleted: false },
    });
  }

  async upsertMany(userId: string, month: string, dto: UpsertBudgetDto): Promise<Budget[]> {
    const existingBudgets = await this.budgetsRepository.find({
      where: { userId, month },
    });

    // Budgets are keyed by parent category id; accept names from older clients.
    const wanted = new Map<string, number>();
    for (const b of dto.budgets) {
      const key = normalizeBudgetKey(b.category);
      wanted.set(key, (wanted.get(key) ?? 0) + b.limit);
    }

    const existingCategoryMap = new Map(existingBudgets.map(b => [b.category, b]));
    const toSave: Budget[] = [];

    // Removed budgets are soft-deleted so the mobile app gets a tombstone.
    for (const eb of existingBudgets) {
      if (!wanted.has(eb.category) && !eb.isDeleted) {
        eb.isDeleted = true;
        eb.version = (eb.version || 1) + 1;
        toSave.push(eb);
      }
    }

    // Identify which to insert or update
    for (const [category, limit] of wanted) {
      const existing = existingCategoryMap.get(category);
      if (existing) {
        existing.limit = limit;
        existing.isDeleted = false;
        existing.version = (existing.version || 1) + 1;
        toSave.push(existing);
      } else {
        toSave.push(this.budgetsRepository.create({ userId, month, category, limit }));
      }
    }

    const saved = await this.budgetsRepository.save(toSave);
    return saved.filter(b => !b.isDeleted);
  }

  async updateCategoryLimit(
    userId: string,
    month: string,
    rawCategory: string,
    limit: number,
  ): Promise<Budget> {
    const category = normalizeBudgetKey(rawCategory);
    let budget = await this.budgetsRepository.findOne({
      where: { userId, month, category },
    });

    if (budget) {
      budget.limit = limit;
      budget.isDeleted = false;
      budget.version = (budget.version || 1) + 1;
    } else {
      budget = this.budgetsRepository.create({
        userId,
        month,
        category,
        limit,
      });
    }

    return this.budgetsRepository.save(budget);
  }

  async getStatus(userId: string, month: string) {
    if (!/^\d{4}-\d{2}$/.test(month)) {
      throw new BadRequestException('Month must be in YYYY-MM format');
    }

    // Month-specific budgets, plus the mobile app's every-month ('all') limits
    // for categories without a month-specific one.
    const [monthBudgets, allBudgets, names] = await Promise.all([
      this.budgetsRepository.find({ where: { userId, month, isDeleted: false } }),
      this.budgetsRepository.find({ where: { userId, month: 'all', isDeleted: false } }),
      this.categoriesService.namesForUser(userId),
    ]);
    const budgets = [
      ...monthBudgets,
      ...allBudgets.filter(a => !monthBudgets.some(m => normalizeBudgetKey(m.category) === normalizeBudgetKey(a.category))),
    ];

    const startDate = new Date(`${month}-01T00:00:00.000Z`);
    const endDate = new Date(startDate);
    endDate.setMonth(startDate.getMonth() + 1);

    const expenses = await this.expensesRepository.find({
      where: {
        userId,
        isDeleted: false,
        date: Between(startDate, new Date(endDate.getTime() - 1)),
      },
    });

    // Spend per parent category id (debits counted as spend only).
    const categorySpentMap = new Map<string, number>();
    for (const exp of expenses) {
      if (exp.isCountedAsSpend === false || exp.amount <= 0) continue;
      const key = exp.categoryId ?? resolveLegacyCategory(exp.category).categoryId;
      categorySpentMap.set(key, (categorySpentMap.get(key) ?? 0) + exp.amount);
    }

    const budgetStatuses = budgets.map(budget => {
      const categoryId = normalizeBudgetKey(budget.category);
      const spent = categorySpentMap.get(categoryId) ?? 0;
      const remaining = budget.limit - spent;
      const percentUsed = budget.limit > 0 ? (spent / budget.limit) * 100 : 0;

      let status: 'OK' | 'WARNING' | 'EXCEEDED' = 'OK';
      if (percentUsed >= 100) {
        status = 'EXCEEDED';
      } else if (percentUsed >= 80) {
        status = 'WARNING';
      }

      return {
        category: names.name(categoryId) ?? budget.category,
        categoryId,
        month: budget.month,
        limit: budget.limit,
        spent,
        remaining,
        percentUsed: Math.round(percentUsed),
        status,
      };
    });

    return {
      month,
      budgets: budgetStatuses,
    };
  }
}

/** Budget keys are parent category ids; older rows may still hold a name. */
function normalizeBudgetKey(category: string): string {
  const system = SYSTEM_BY_ID.get(category);
  if (system) return system.parentId ?? system.id;
  const lower = category.trim().toLowerCase();
  const isKnownName =
    LEGACY_CATEGORY_MAP[lower] !== undefined ||
    [...SYSTEM_BY_ID.values()].some((c) => c.name.toLowerCase() === lower);
  // Anything else is a custom category id.
  return isKnownName ? resolveLegacyCategory(category).categoryId : category;
}

export { normalizeBudgetKey };
