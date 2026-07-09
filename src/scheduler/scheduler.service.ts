import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, IsNull, Between } from 'typeorm';
import { Loan } from '../database/entities/loan.entity';
import { Investment } from '../database/entities/investment.entity';
import { User } from '../database/entities/user.entity';
import { Expense } from '../database/entities/expense.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { SheetsService } from '../sheets/sheets.service';
import { LoanStatus } from '../database/enums';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    @InjectRepository(Loan)
    private readonly loansRepository: Repository<Loan>,
    @InjectRepository(Investment)
    private readonly investmentsRepository: Repository<Investment>,
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Expense)
    private readonly expensesRepository: Repository<Expense>,
    private readonly notificationsService: NotificationsService,
    private readonly sheetsService: SheetsService,
  ) {}

  private isSameDay(d1: Date, d2: Date): boolean {
    return (
      d1.getFullYear() === d2.getFullYear() &&
      d1.getMonth() === d2.getMonth() &&
      d1.getDate() === d2.getDate()
    );
  }

  // Runs every day at 9:00 AM IST (3:30 AM UTC)
  @Cron('0 30 3 * * *')
  async checkLoanReminders(): Promise<void> {
    this.logger.log('Running checkLoanReminders job...');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const target1 = new Date(today); target1.setDate(today.getDate() + 1);
    const target3 = new Date(today); target3.setDate(today.getDate() + 3);
    const target7 = new Date(today); target7.setDate(today.getDate() + 7);

    const activeLoans = await this.loansRepository.find({
      where: {
        status: Not(LoanStatus.PAID),
        reminderSent: false,
        repaymentDate: Not(IsNull()),
      },
    });

    for (const loan of activeLoans) {
      if (!loan.repaymentDate) {
        continue;
      }
      const repayment = new Date(loan.repaymentDate);
      repayment.setHours(0, 0, 0, 0);

      let daysRemaining = 0;
      let matched = false;

      if (this.isSameDay(repayment, target1)) {
        daysRemaining = 1;
        matched = true;
      } else if (this.isSameDay(repayment, target3)) {
        daysRemaining = 3;
        matched = true;
      } else if (this.isSameDay(repayment, target7)) {
        daysRemaining = 7;
        matched = true;
      }

      if (matched) {
        await this.notificationsService.sendLoanReminder(
          loan.userId,
          loan.name,
          loan.total,
          daysRemaining,
        );
        loan.reminderSent = true;
        await this.loansRepository.save(loan);
      }
    }
  }

  // Runs every day at 9:00 AM IST (3:30 AM UTC)
  @Cron('0 30 3 * * *')
  async checkMaturityReminders(): Promise<void> {
    this.logger.log('Running checkMaturityReminders job...');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const target7 = new Date(today); target7.setDate(today.getDate() + 7);
    const target30 = new Date(today); target30.setDate(today.getDate() + 30);

    const investments = await this.investmentsRepository.find();

    for (const inv of investments) {
      const maturity = new Date(inv.maturityDate);
      maturity.setHours(0, 0, 0, 0);

      let daysRemaining = 0;
      let matched = false;

      if (this.isSameDay(maturity, target7)) {
        daysRemaining = 7;
        matched = true;
      } else if (this.isSameDay(maturity, target30)) {
        daysRemaining = 30;
        matched = true;
      }

      if (matched) {
        await this.notificationsService.sendMaturityReminder(
          inv.userId,
          inv.name,
          inv.maturityAmount,
          daysRemaining,
        );
      }
    }
  }

  // Runs on 1st of every month at 8:00 AM IST (2:30 AM UTC)
  @Cron('0 30 2 1 * *')
  async sendMonthlyDigest(): Promise<void> {
    this.logger.log('Running sendMonthlyDigest job...');
    const users = await this.usersRepository.find({
      where: { fcmToken: Not(IsNull()) },
    });

    const prevMonthDate = new Date();
    prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
    
    const year = prevMonthDate.getFullYear();
    const monthIndex = prevMonthDate.getMonth();
    const startDate = new Date(year, monthIndex, 1);
    const endDate = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
    
    const monthName = startDate.toLocaleString('default', { month: 'long' });

    for (const user of users) {
      const expenses = await this.expensesRepository.find({
        where: {
          userId: user.id,
          date: Between(startDate, endDate),
        },
      });

      const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
      const totalIncome = 0; // standard default
      const balance = totalIncome - totalExpenses;

      await this.notificationsService.sendMonthlySummary(user.id, monthName, balance);
    }
  }

  // Runs on 1st of every month at 8:30 AM IST (3:00 AM UTC)
  @Cron('0 0 3 1 * *')
  async autoSyncSheets(): Promise<void> {
    this.logger.log('Running autoSyncSheets job...');
    const connectedUsers = await this.usersRepository.find({
      where: { sheetsConnected: true },
    });

    for (const user of connectedUsers) {
      try {
        await this.sheetsService.sync(user.id);
        this.logger.log(`Auto synced Google Sheets for user: ${user.id}`);
      } catch (error) {
        this.logger.error(`Auto sync failed for user ${user.id}: ${error.message}`);
      }
    }
  }
}
