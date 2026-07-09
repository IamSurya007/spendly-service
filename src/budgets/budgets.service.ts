import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { Budget } from '../database/entities/budget.entity';
import { Expense } from '../database/entities/expense.entity';
import { UpsertBudgetDto } from './dto/upsert-budget.dto';

@Injectable()
export class BudgetsService {
  constructor(
    @InjectRepository(Budget)
    private readonly budgetsRepository: Repository<Budget>,
    @InjectRepository(Expense)
    private readonly expensesRepository: Repository<Expense>,
  ) {}

  async findAll(userId: string, month: string): Promise<Budget[]> {
    return this.budgetsRepository.find({
      where: { userId, month },
    });
  }

  async upsertMany(userId: string, month: string, dto: UpsertBudgetDto): Promise<Budget[]> {
    const existingBudgets = await this.budgetsRepository.find({
      where: { userId, month },
    });

    const existingCategoryMap = new Map(existingBudgets.map(b => [b.category, b]));
    const targetCategories = new Set(dto.budgets.map(b => b.category));

    const toSave: Budget[] = [];
    const toDelete: Budget[] = [];

    // Identify which to delete
    for (const eb of existingBudgets) {
      if (!targetCategories.has(eb.category)) {
        toDelete.push(eb);
      }
    }

    // Identify which to insert or update
    for (const sb of dto.budgets) {
      const existing = existingCategoryMap.get(sb.category);
      if (existing) {
        existing.limit = sb.limit;
        toSave.push(existing);
      } else {
        const newBudget = this.budgetsRepository.create({
          userId,
          month,
          category: sb.category,
          limit: sb.limit,
        });
        toSave.push(newBudget);
      }
    }

    if (toDelete.length > 0) {
      await this.budgetsRepository.remove(toDelete);
    }

    return this.budgetsRepository.save(toSave);
  }

  async updateCategoryLimit(
    userId: string,
    month: string,
    category: string,
    limit: number,
  ): Promise<Budget> {
    let budget = await this.budgetsRepository.findOne({
      where: { userId, month, category },
    });

    if (budget) {
      budget.limit = limit;
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

    const budgets = await this.budgetsRepository.find({
      where: { userId, month },
    });

    const startDate = new Date(`${month}-01T00:00:00.000Z`);
    const endDate = new Date(startDate);
    endDate.setMonth(startDate.getMonth() + 1);

    const expenses = await this.expensesRepository.find({
      where: {
        userId,
        date: Between(startDate, new Date(endDate.getTime() - 1)),
      },
    });

    // Group expenses by category
    const categorySpentMap = new Map<string, number>();
    for (const exp of expenses) {
      const current = categorySpentMap.get(exp.category) ?? 0;
      categorySpentMap.set(exp.category, current + exp.amount);
    }

    const budgetStatuses = budgets.map(budget => {
      const spent = categorySpentMap.get(budget.category) ?? 0;
      const remaining = budget.limit - spent;
      const percentUsed = budget.limit > 0 ? (spent / budget.limit) * 100 : 0;
      
      let status: 'OK' | 'WARNING' | 'EXCEEDED' = 'OK';
      if (percentUsed >= 100) {
        status = 'EXCEEDED';
      } else if (percentUsed >= 80) {
        status = 'WARNING';
      }

      return {
        category: budget.category,
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
