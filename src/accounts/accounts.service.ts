import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Account } from '../database/entities/account.entity';
import { CreateAccountDto } from './dto/create-account.dto';
import { UpdateAccountDto } from './dto/update-account.dto';
import { AccountType } from '../database/enums';

@Injectable()
export class AccountsService {
  constructor(
    @InjectRepository(Account)
    private readonly accountsRepository: Repository<Account>,
  ) {}

  async ensureDefaultAccount(userId: string): Promise<Account> {
    let account = await this.accountsRepository.findOne({
      where: [
        { id: 'default_bank', userId },
        { clientId: 'default_bank', userId },
      ],
    });

    if (!account) {
      account = this.accountsRepository.create({
        id: 'default_bank',
        userId,
        name: 'Default Bank Account',
        type: AccountType.BANK,
        currentBalance: 0,
        creditLimit: 0,
        accountNumberLast4: '0000',
        colorValue: 4280962800,
        version: 1,
        isDeleted: false,
      });
      account = await this.accountsRepository.save(account);
    }

    return account;
  }

  async validateAccountExists(userId: string, accountId: string): Promise<boolean> {
    const targetId = accountId || 'default_bank';
    const account = await this.accountsRepository.findOne({
      where: [
        { id: targetId, userId, isDeleted: false },
        { clientId: targetId, userId, isDeleted: false },
      ],
    });

    if (account) return true;

    if (targetId === 'default_bank') {
      await this.ensureDefaultAccount(userId);
      return true;
    }

    return false;
  }

  async create(userId: string, dto: CreateAccountDto): Promise<Account> {
    const account = this.accountsRepository.create({
      ...dto,
      userId,
      type: dto.type || AccountType.BANK,
      currentBalance: dto.currentBalance ?? 0,
      creditLimit: dto.creditLimit ?? 0,
      accountNumberLast4: dto.accountNumberLast4 || null,
      colorValue: dto.colorValue ?? 4280962800,
      version: 1,
      isDeleted: false,
    });

    return this.accountsRepository.save(account);
  }

  async findAll(userId: string): Promise<Account[]> {
    await this.ensureDefaultAccount(userId);
    return this.accountsRepository.find({
      where: { userId, isDeleted: false },
      order: { createdAt: 'ASC' },
    });
  }

  async findOne(userId: string, id: string): Promise<Account> {
    const account = await this.accountsRepository.findOne({ where: { id } });
    if (!account || account.isDeleted) {
      throw new NotFoundException('Account not found');
    }
    if (account.userId !== userId) {
      throw new ForbiddenException("You cannot access another user's account");
    }
    return account;
  }

  async update(userId: string, id: string, dto: UpdateAccountDto): Promise<Account> {
    const account = await this.findOne(userId, id);

    if (dto.name !== undefined) account.name = dto.name;
    if (dto.type !== undefined) account.type = dto.type;
    if (dto.currentBalance !== undefined) account.currentBalance = dto.currentBalance;
    if (dto.creditLimit !== undefined) account.creditLimit = dto.creditLimit;
    if (dto.accountNumberLast4 !== undefined) account.accountNumberLast4 = dto.accountNumberLast4;
    if (dto.colorValue !== undefined) account.colorValue = dto.colorValue;

    account.version = (account.version || 1) + 1;
    account.updatedAt = new Date();

    return this.accountsRepository.save(account);
  }

  async remove(userId: string, id: string): Promise<void> {
    const account = await this.findOne(userId, id);
    account.isDeleted = true;
    account.version = (account.version || 1) + 1;
    account.updatedAt = new Date();
    await this.accountsRepository.save(account);
  }
}
