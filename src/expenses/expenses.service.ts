import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThan } from 'typeorm';
import { Expense } from '../database/entities/expense.entity';
import { Budget } from '../database/entities/budget.entity';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { QueryExpenseDto } from './dto/query-expense.dto';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class ExpensesService {
  constructor(
    @InjectRepository(Expense)
    private readonly expensesRepository: Repository<Expense>,
    @InjectRepository(Budget)
    private readonly budgetsRepository: Repository<Budget>,
    private readonly notificationsService: NotificationsService,
  ) {}

  async create(userId: string, dto: CreateExpenseDto): Promise<Expense> {
    const expense = this.expensesRepository.create({
      ...dto,
      userId,
      date: new Date(dto.date),
    });

    const savedExpense = await this.expensesRepository.save(expense);

    // Trigger budget check asynchronously
    this.checkBudgetAlert(userId, dto.category, dto.date).catch(err => {
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
      date: Between(startDate, new Date(endDate.getTime() - 1)),
    };

    if (query.category) {
      whereConditions.category = query.category;
    }

    if (query.source) {
      whereConditions.source = query.source;
    }

    // Apply cursor pagination if cursor is provided
    if (query.cursor) {
      const cursorExpense = await this.expensesRepository.findOne({
        where: { id: query.cursor, userId },
      });
      if (cursorExpense) {
        // Find expenses with date less than cursor date, OR same date and ID less than cursor ID (for descending order)
        const cursorDate = cursorExpense.date;
        const cursorId = cursorExpense.id;

        return this.expensesRepository.find({
          where: [
            { ...whereConditions, date: LessThan(cursorDate) },
            { ...whereConditions, date: cursorDate, id: LessThan(cursorId) },
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
      where: whereConditions,
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
    
    if (dto.amount !== undefined) expense.amount = dto.amount;
    if (dto.category !== undefined) expense.category = dto.category;
    if (dto.note !== undefined) expense.note = dto.note;
    if (dto.date !== undefined) expense.date = new Date(dto.date);
    if (dto.method !== undefined) expense.method = dto.method;
    if (dto.source !== undefined) expense.source = dto.source;
    if (dto.merchant !== undefined) expense.merchant = dto.merchant;

    const saved = await this.expensesRepository.save(expense);

    if (dto.category !== undefined || dto.amount !== undefined || dto.date !== undefined) {
      const dateToCheck = dto.date || expense.date.toISOString();
      const categoryToCheck = dto.category || expense.category;
      this.checkBudgetAlert(userId, categoryToCheck, dateToCheck).catch(err => {
        console.error(`Failed to check budget alert after update: ${err.message}`);
      });
    }

    return saved;
  }

  async remove(userId: string, id: string): Promise<void> {
    const expense = await this.findOne(userId, id);
    await this.expensesRepository.remove(expense);
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

    const expenses = await this.expensesRepository.find({
      where: {
        userId,
        date: Between(startDate, new Date(endDate.getTime() - 1)),
      },
    });

    const totalExpenses = expenses.reduce((sum, exp) => sum + exp.amount, 0);
    // Since there's no Income table, default to 0
    const totalIncome = 0;
    const balance = totalIncome - totalExpenses;

    // Group by category
    const categoryMap: { [key: string]: { total: number; count: number } } = {};
    for (const exp of expenses) {
      if (!categoryMap[exp.category]) {
        categoryMap[exp.category] = { total: 0, count: 0 };
      }
      categoryMap[exp.category].total += exp.amount;
      categoryMap[exp.category].count += 1;
    }

    const byCategory = Object.keys(categoryMap).map(category => ({
      category,
      total: categoryMap[category].total,
      count: categoryMap[category].count,
    }));

    return {
      month,
      totalExpenses,
      totalIncome,
      balance,
      byCategory,
    };
  }

  private async checkBudgetAlert(userId: string, category: string, dateStr: string): Promise<void> {
    const month = dateStr.substring(0, 7); // extract "YYYY-MM"
    
    // Find budget for this category
    const budget = await this.budgetsRepository.findOne({
      where: { userId, month, category },
    });

    if (!budget) return;

    // Calculate total spent in this category for this month
    const startDate = new Date(`${month}-01T00:00:00.000Z`);
    const endDate = new Date(startDate);
    endDate.setMonth(startDate.getMonth() + 1);

    const expenses = await this.expensesRepository.find({
      where: {
        userId,
        category,
        date: Between(startDate, new Date(endDate.getTime() - 1)),
      },
    });

    const totalSpent = expenses.reduce((sum, exp) => sum + exp.amount, 0);
    const percentUsed = (totalSpent / budget.limit) * 100;

    if (percentUsed >= 80) {
      await this.notificationsService.sendBudgetAlert(userId, category, percentUsed);
    }
  }
}
