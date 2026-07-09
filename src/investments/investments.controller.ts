import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { InvestmentsService } from './investments.service';
import { CreateInvestmentDto } from './dto/create-investment.dto';
import { UpdateInvestmentDto } from './dto/update-investment.dto';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiBearerAuth('bearer')
@Controller('investments')
export class InvestmentsController {
  constructor(private readonly investmentsService: InvestmentsService) {}

  @Get('summary')
  async getSummary(@CurrentUser('uid') userId: string) {
    return this.investmentsService.getSummary(userId);
  }

  @Post()
  async create(
    @CurrentUser('uid') userId: string,
    @Body() dto: CreateInvestmentDto,
  ) {
    return this.investmentsService.create(userId, dto);
  }

  @Get()
  async findAll(@CurrentUser('uid') userId: string) {
    return this.investmentsService.findAll(userId);
  }

  @Get(':id')
  async findOne(
    @CurrentUser('uid') userId: string,
    @Param('id') id: string,
  ) {
    return this.investmentsService.findOne(userId, id);
  }

  @Patch(':id')
  async update(
    @CurrentUser('uid') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateInvestmentDto,
  ) {
    return this.investmentsService.update(userId, id, dto);
  }

  @Delete(':id')
  async remove(
    @CurrentUser('uid') userId: string,
    @Param('id') id: string,
  ) {
    await this.investmentsService.remove(userId, id);
    return { message: 'Investment deleted successfully' };
  }
}
