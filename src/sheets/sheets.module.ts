import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../database/entities/user.entity';
import { Expense } from '../database/entities/expense.entity';
import { Loan } from '../database/entities/loan.entity';
import { Investment } from '../database/entities/investment.entity';
import { SheetsService } from './sheets.service';
import { SheetsController } from './sheets.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User, Expense, Loan, Investment])],
  providers: [SheetsService],
  controllers: [SheetsController],
  exports: [SheetsService],
})
export class SheetsModule {}
