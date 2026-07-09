import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../database/entities/user.entity';
import * as admin from 'firebase-admin';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  private async sendNotification(userId: string, title: string, body: string): Promise<void> {
    try {
      const user = await this.usersRepository.findOne({ where: { id: userId } });
      if (!user || !user.fcmToken) {
        this.logger.warn(`No FCM token found for user ${userId}. Skipping notification.`);
        return;
      }

      const message: admin.messaging.Message = {
        notification: {
          title,
          body,
        },
        token: user.fcmToken,
      };

      await admin.messaging().send(message);
      this.logger.log(`Notification sent successfully to user ${userId}: ${body}`);
    } catch (error) {
      this.logger.error(`Failed to send notification to user ${userId}: ${error.message}`);
    }
  }

  async sendBudgetAlert(userId: string, category: string, percentUsed: number): Promise<void> {
    const title = 'Budget Alert';
    const body = `You've used ${Math.round(percentUsed)}% of your ${category} budget this month`;
    await this.sendNotification(userId, title, body);
  }

  async sendLoanReminder(userId: string, loanName: string, amount: number, daysRemaining: number): Promise<void> {
    const title = 'Loan Repayment Reminder';
    const formattedAmount = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
    const body = `${loanName}'s repayment of ${formattedAmount} is due in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`;
    await this.sendNotification(userId, title, body);
  }

  async sendMaturityReminder(userId: string, rdName: string, maturityAmount: number, daysRemaining: number): Promise<void> {
    const title = 'Investment Maturity Reminder';
    const formattedAmount = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(maturityAmount);
    const body = `Your ${rdName} matures in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} with ${formattedAmount}`;
    await this.sendNotification(userId, title, body);
  }

  async sendMonthlySummary(userId: string, month: string, balance: number): Promise<void> {
    const title = 'Monthly Digest';
    const formattedBalance = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(balance);
    const body = `Your ${month} summary is ready. Balance: ${formattedBalance}`;
    await this.sendNotification(userId, title, body);
  }
}
