import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { Expense } from '../database/entities/expense.entity';
import { Loan } from '../database/entities/loan.entity';
import { Investment } from '../database/entities/investment.entity';
import { Budget } from '../database/entities/budget.entity';
import { CategoryRule } from '../database/entities/category-rule.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Expense,
      Loan,
      Investment,
      Budget,
      CategoryRule,
    ]),
  ],
  controllers: [SyncController],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
