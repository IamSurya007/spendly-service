import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccountsService } from './accounts.service';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { CurrentUser } from '../auth/current-user.decorator';

@ApiTags('accounts')
@ApiBearerAuth('bearer')
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new bank/credit card/wallet account' })
  async create(
    @CurrentUser('uid') userId: string,
    @Body() dto: CreateAccountDto,
  ) {
    return this.accountsService.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all active user accounts' })
  async findAll(@CurrentUser('uid') userId: string) {
    return this.accountsService.findAll(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get details of a specific account' })
  async findOne(
    @CurrentUser('uid') userId: string,
    @Param('id') id: string,
  ) {
    return this.accountsService.findOne(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an account' })
  async update(
    @CurrentUser('uid') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAccountDto,
  ) {
    return this.accountsService.update(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft delete an account' })
  async remove(
    @CurrentUser('uid') userId: string,
    @Param('id') id: string,
  ) {
    await this.accountsService.remove(userId, id);
    return { message: 'Account deleted successfully' };
  }
}
