import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Expense } from '../database/entities/expense.entity';
import { Budget } from '../database/entities/budget.entity';
import { ExpensesService } from './expenses.service';
import { ExpensesController } from './expenses.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Expense, Budget]),
    NotificationsModule,
  ],
  providers: [ExpensesService],
  controllers: [ExpensesController],
  exports: [ExpensesService],
})
export class ExpensesModule {}
