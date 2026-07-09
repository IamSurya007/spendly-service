import { Controller, Get, Post, Patch, Delete, Body, Param, Query } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { LoansService } from './loans.service';
import { CreateLoanDto } from './dto/create-loan.dto';
import { UpdateLoanDto } from './dto/update-loan.dto';
import { LoanType, LoanStatus } from '../database/enums';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiBearerAuth('bearer')
@Controller('loans')
export class LoansController {
  constructor(private readonly loansService: LoansService) {}

  @Get('summary')
  async getSummary(@CurrentUser('uid') userId: string) {
    return this.loansService.getSummary(userId);
  }

  @Post()
  async create(
    @CurrentUser('uid') userId: string,
    @Body() dto: CreateLoanDto,
  ) {
    return this.loansService.create(userId, dto);
  }

  @Get()
  async findAll(
    @CurrentUser('uid') userId: string,
    @Query('type') type?: LoanType,
    @Query('status') status?: LoanStatus,
  ) {
    return this.loansService.findAll(userId, type, status);
  }

  @Get(':id')
  async findOne(
    @CurrentUser('uid') userId: string,
    @Param('id') id: string,
  ) {
    return this.loansService.findOne(userId, id);
  }

  @Patch(':id')
  async update(
    @CurrentUser('uid') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateLoanDto,
  ) {
    return this.loansService.update(userId, id, dto);
  }

  @Delete(':id')
  async remove(
    @CurrentUser('uid') userId: string,
    @Param('id') id: string,
  ) {
    await this.loansService.remove(userId, id);
    return { message: 'Loan deleted successfully' };
  }
}
