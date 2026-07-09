import { Controller, Get, Put, Patch, Body, Param } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { BudgetsService } from './budgets.service';
import { UpsertBudgetDto, UpdateBudgetLimitDto } from './dto/upsert-budget.dto';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiBearerAuth('bearer')
@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Get(':month/status')
  async getStatus(
    @CurrentUser('uid') userId: string,
    @Param('month') month: string,
  ) {
    return this.budgetsService.getStatus(userId, month);
  }

  @Get(':month')
  async findAll(
    @CurrentUser('uid') userId: string,
    @Param('month') month: string,
  ) {
    return this.budgetsService.findAll(userId, month);
  }

  @Put(':month')
  async upsertMany(
    @CurrentUser('uid') userId: string,
    @Param('month') month: string,
    @Body() dto: UpsertBudgetDto,
  ) {
    return this.budgetsService.upsertMany(userId, month, dto);
  }

  @Patch(':month/:category')
  async updateCategoryLimit(
    @CurrentUser('uid') userId: string,
    @Param('month') month: string,
    @Param('category') category: string,
    @Body() dto: UpdateBudgetLimitDto,
  ) {
    return this.budgetsService.updateCategoryLimit(userId, month, category, dto.limit);
  }
}
