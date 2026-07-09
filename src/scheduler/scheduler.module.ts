import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Loan } from '../database/entities/loan.entity';
import { Investment } from '../database/entities/investment.entity';
import { User } from '../database/entities/user.entity';
import { Expense } from '../database/entities/expense.entity';
import { NotificationsModule } from '../notifications/notifications.module';
import { SheetsModule } from '../sheets/sheets.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Loan, Investment, User, Expense]),
    NotificationsModule,
    SheetsModule,
  ],
  providers: [SchedulerService],
})
export class SchedulerModule {}
