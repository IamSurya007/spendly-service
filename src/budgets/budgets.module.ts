import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Budget } from '../database/entities/budget.entity';
import { Expense } from '../database/entities/expense.entity';
import { BudgetsService } from './budgets.service';
import { BudgetsController } from './budgets.controller';
import { CategoriesModule } from '../categories/categories.module';

@Module({
  imports: [TypeOrmModule.forFeature([Budget, Expense]), CategoriesModule],
  providers: [BudgetsService],
  controllers: [BudgetsController],
  exports: [BudgetsService],
})
export class BudgetsModule {}
