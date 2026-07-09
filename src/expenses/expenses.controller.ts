import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { QueryExpenseDto } from './dto/query-expense.dto';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiBearerAuth('bearer')
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post()
  async create(
    @CurrentUser('uid') userId: string,
    @Body() dto: CreateExpenseDto,
  ) {
    return this.expensesService.create(userId, dto);
  }

  @Get('summary')
  async getSummary(
    @CurrentUser('uid') userId: string,
    @Query('month') month?: string,
  ) {
    return this.expensesService.getSummary(userId, month);
  }

  @Get()
  async findAll(
    @CurrentUser('uid') userId: string,
    @Query() query: QueryExpenseDto,
  ) {
    return this.expensesService.findAll(userId, query);
  }

  @Get(':id')
  async findOne(
    @CurrentUser('uid') userId: string,
    @Param('id') id: string,
  ) {
    return this.expensesService.findOne(userId, id);
  }

  @Patch(':id')
  async update(
    @CurrentUser('uid') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateExpenseDto,
  ) {
    return this.expensesService.update(userId, id, dto);
  }

  @Delete(':id')
  async remove(
    @CurrentUser('uid') userId: string,
    @Param('id') id: string,
  ) {
    await this.expensesService.remove(userId, id);
    return { message: 'Expense deleted successfully' };
  }
}
