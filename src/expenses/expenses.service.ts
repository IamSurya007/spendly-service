import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThan } from 'typeorm';
import { Expense } from '../database/entities/expense.entity';
import { Budget } from '../database/entities/budget.entity';
import { Account } from '../database/entities/account.entity';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { QueryExpenseDto } from './dto/query-expense.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { AccountType } from '../database/enums';
import { CategoriesService } from '../categories/categories.service';
import { resolveLegacyCategory } from '../categories/category-resolver';

@Injectable()
export class ExpensesService {
  constructor(
    @InjectRepository(Expense)
    private readonly expensesRepository: Repository<Expense>,
    @InjectRepository(Budget)
    private readonly budgetsRepository: Repository<Budget>,
    @InjectRepository(Account)
    private readonly accountsRepository: Repository<Account>,
    private readonly notificationsService: NotificationsService,
    private readonly categoriesService: CategoriesService,
  ) {}

  private async validateAndGetAccountId(userId: string, accountId?: string): Promise<string> {
    const targetId = accountId && accountId.trim() !== '' ? accountId.trim() : 'default_bank';

    const account = await this.accountsRepository.findOne({
      where: [
        { id: targetId, userId, isDeleted: false },
        { clientId: targetId, userId, isDeleted: false },
      ],
    });

    if (account) {
      return account.id;
    }

    if (targetId === 'default_bank') {
      const defaultAcc = this.accountsRepository.create({
        id: 'default_bank',
        userId,
        name: 'Default Bank Account',
        type: AccountType.BANK,
        currentBalance: 0,
        creditLimit: 0,
        accountNumberLast4: '0000',
        colorValue: 4280962800,
        version: 1,
        isDeleted: false,
      });
      await this.accountsRepository.save(defaultAcc);
      return 'default_bank';
    }

    throw new BadRequestException(`Account with id '${targetId}' not found for user`);
  }

  async create(userId: string, dto: CreateExpenseDto): Promise<Expense> {
    const validAccountId = await this.validateAndGetAccountId(userId, dto.accountId);

    const ids = dto.categoryId
      ? { categoryId: dto.categoryId, subcategoryId: dto.subcategoryId ?? null }
      : resolveLegacyCategory(dto.category, false);

    const expense = this.expensesRepository.create({
      ...dto,
      categoryId: ids.categoryId,
      subcategoryId: ids.subcategoryId,
      userId,
      accountId: validAccountId,
      isCountedAsSpend: dto.isCountedAsSpend ?? true,
      date: new Date(dto.date),
    });

    const savedExpense = await this.expensesRepository.save(expense);

    // Trigger budget check asynchronously
    this.checkBudgetAlert(userId, ids.categoryId, dto.date).catch(err => {
      console.error(`Failed to check budget alert: ${err.message}`);
    });

    return savedExpense;
  }

  async findAll(userId: string, query: QueryExpenseDto): Promise<Expense[]> {
    const startDate = new Date(`${query.month}-01T00:00:00.000Z`);
    const endDate = new Date(startDate);
    endDate.setMonth(startDate.getMonth() + 1);

    const whereConditions: any = {
      userId,
      isDeleted: false,
      date: Between(startDate, new Date(endDate.getTime() - 1)),
    };

    if (query.category) {
      whereConditions.category = query.category;
    }

    if (query.source) {
      whereConditions.source = query.source;
    }

    // A category id matches expenses in that category or subcategory.
    const categoryVariants: any[] = query.categoryId
      ? [{ categoryId: query.categoryId }, { subcategoryId: query.categoryId }]
      : [{}];
    const withCategory = (extra: any) => categoryVariants.map((v) => ({ ...whereConditions, ...v, ...extra }));

    // Apply cursor pagination if cursor is provided
    if (query.cursor) {
      const cursorExpense = await this.expensesRepository.findOne({
        where: { id: query.cursor, userId },
      });
      if (cursorExpense) {
        const cursorDate = cursorExpense.date;
        const cursorId = cursorExpense.id;

        return this.expensesRepository.find({
          where: [
            ...withCategory({ date: LessThan(cursorDate) }),
            ...withCategory({ date: cursorDate, id: LessThan(cursorId) }),
          ],
          order: {
            date: 'DESC',
            id: 'DESC',
          },
          take: query.limit,
        });
      }
    }

    return this.expensesRepository.find({
      where: withCategory({}),
      order: {
        date: 'DESC',
        id: 'DESC',
      },
      take: query.limit,
    });
  }

  async findOne(userId: string, id: string): Promise<Expense> {
    const expense = await this.expensesRepository.findOne({ where: { id } });
    if (!expense) {
      throw new NotFoundException('Expense not found');
    }
    if (expense.userId !== userId) {
      throw new ForbiddenException("You cannot access another user's expense");
    }
    return expense;
  }

  async update(userId: string, id: string, dto: UpdateExpenseDto): Promise<Expense> {
    const expense = await this.findOne(userId, id);

    if (dto.accountId !== undefined) {
      expense.accountId = await this.validateAndGetAccountId(userId, dto.accountId);
    }
    if (dto.isCountedAsSpend !== undefined) expense.isCountedAsSpend = dto.isCountedAsSpend;
    if (dto.amount !== undefined) expense.amount = dto.amount;
    if (dto.category !== undefined) expense.category = dto.category;
    if (dto.categoryId !== undefined) {
      expense.categoryId = dto.categoryId;
      expense.subcategoryId = dto.subcategoryId ?? null;
      expense.subcategory = dto.subcategory ?? null;
    } else if (dto.category !== undefined) {
      const ids = resolveLegacyCategory(dto.category, expense.amount < 0);
      expense.categoryId = ids.categoryId;
      expense.subcategoryId = ids.subcategoryId;
    }
    if (dto.note !== undefined) expense.note = dto.note;
    if (dto.date !== undefined) expense.date = new Date(dto.date);
    if (dto.method !== undefined) expense.method = dto.method;
    if (dto.source !== undefined) expense.source = dto.source;
    if (dto.merchant !== undefined) expense.merchant = dto.merchant;
    // Bump the version so offline clients accept this edit on their next pull.
    expense.version = (expense.version || 1) + 1;

    const saved = await this.expensesRepository.save(expense);

    if (dto.category !== undefined || dto.categoryId !== undefined || dto.amount !== undefined || dto.date !== undefined || dto.isCountedAsSpend !== undefined) {
      const dateToCheck = dto.date || expense.date.toISOString();
      this.checkBudgetAlert(userId, expense.categoryId, dateToCheck).catch(err => {
        console.error(`Failed to check budget alert after update: ${err.message}`);
      });
    }

    return saved;
  }

  async remove(userId: string, id: string): Promise<void> {
    const expense = await this.findOne(userId, id);
    // Soft delete so the mobile app receives a tombstone on its next pull.
    expense.isDeleted = true;
    expense.version = (expense.version || 1) + 1;
    await this.expensesRepository.save(expense);
  }

  async getSummary(userId: string, month?: string) {
    let targetMonth = month;
    if (!targetMonth) {
      const now = new Date();
      targetMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    } else if (!/^\d{4}-\d{2}$/.test(targetMonth)) {
      throw new BadRequestException('Month must be in YYYY-MM format');
    }

    const startDate = new Date(`${targetMonth}-01T00:00:00.000Z`);
    const endDate = new Date(startDate);
    endDate.setMonth(startDate.getMonth() + 1);

    const [expenses, names] = await Promise.all([
      this.expensesRepository.find({
        where: {
          userId,
          isDeleted: false,
          date: Between(startDate, new Date(endDate.getTime() - 1)),
        },
      }),
      this.categoriesService.namesForUser(userId),
    ]);

    const spendExpenses = expenses.filter(exp => exp.isCountedAsSpend !== false && exp.amount > 0);

    const totalExpenses = spendExpenses.reduce((sum, exp) => sum + exp.amount, 0);
    // Since there's no Income table, default to 0
    const totalIncome = 0;
    const balance = totalIncome - totalExpenses;

    // Group by parent category, with a subcategory breakdown.
    type Bucket = { total: number; count: number; subs: Map<string, { total: number; count: number }> };
    const categoryMap = new Map<string, Bucket>();
    for (const exp of spendExpenses) {
      const ids = exp.categoryId
        ? { categoryId: exp.categoryId, subcategoryId: exp.subcategoryId }
        : resolveLegacyCategory(exp.category, false);
      const bucket = categoryMap.get(ids.categoryId) ?? { total: 0, count: 0, subs: new Map() };
      bucket.total += exp.amount;
      bucket.count += 1;
      if (ids.subcategoryId) {
        const sub = bucket.subs.get(ids.subcategoryId) ?? { total: 0, count: 0 };
        sub.total += exp.amount;
        sub.count += 1;
        bucket.subs.set(ids.subcategoryId, sub);
      }
      categoryMap.set(ids.categoryId, bucket);
    }

    const byCategory = [...categoryMap.entries()]
      .map(([categoryId, b]) => ({
        category: names.name(categoryId) ?? categoryId,
        categoryId,
        total: b.total,
        count: b.count,
        subcategories: [...b.subs.entries()]
          .map(([subcategoryId, s]) => ({
            subcategory: names.name(subcategoryId) ?? subcategoryId,
            subcategoryId,
            total: s.total,
            count: s.count,
          }))
          .sort((x, y) => y.total - x.total),
      }))
      .sort((x, y) => y.total - x.total);

    return {
      month: targetMonth,
      totalExpenses,
      totalIncome,
      balance,
      byCategory,
    };
  }

  /**
   * Budgets are keyed by parent category id. The mobile app stores limits
   * that apply to every month under month 'all'; a month-specific budget wins.
   */
  private async checkBudgetAlert(userId: string, categoryId: string | null, dateStr: string): Promise<void> {
    if (!categoryId) return;
    const month = dateStr.substring(0, 7); // extract "YYYY-MM"

    const budgets = await this.budgetsRepository.find({
      where: [
        { userId, month, category: categoryId, isDeleted: false },
        { userId, month: 'all', category: categoryId, isDeleted: false },
      ],
    });
    const budget = budgets.find(b => b.month === month) ?? budgets[0];
    if (!budget || budget.limit <= 0) return;

    // Calculate total spent in this category for this month
    const startDate = new Date(`${month}-01T00:00:00.000Z`);
    const endDate = new Date(startDate);
    endDate.setMonth(startDate.getMonth() + 1);

    const expenses = await this.expensesRepository.find({
      where: {
        userId,
        categoryId,
        isDeleted: false,
        date: Between(startDate, new Date(endDate.getTime() - 1)),
      },
    });

    const spendExpenses = expenses.filter(exp => exp.isCountedAsSpend !== false && exp.amount > 0);

    const totalSpent = spendExpenses.reduce((sum, exp) => sum + exp.amount, 0);
    const percentUsed = (totalSpent / budget.limit) * 100;

    if (percentUsed >= 80) {
      const names = await this.categoriesService.namesForUser(userId);
      await this.notificationsService.sendBudgetAlert(userId, names.name(categoryId) ?? categoryId, percentUsed);
    }
  }
}
