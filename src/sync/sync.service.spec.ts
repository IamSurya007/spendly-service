import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SyncService } from './sync.service';
import { Expense } from '../database/entities/expense.entity';
import { Loan } from '../database/entities/loan.entity';
import { Investment } from '../database/entities/investment.entity';
import { Budget } from '../database/entities/budget.entity';
import { CategoryRule } from '../database/entities/category-rule.entity';
import { Account } from '../database/entities/account.entity';
import { Category } from '../database/entities/category.entity';
import { DataSource } from 'typeorm';

const queryBuilder = () => {
  const qb: any = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    addOrderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  };
  return qb;
};

const mockRepository = () => ({
  findOne: jest.fn(),
  create: jest.fn(entity => ({ id: 'mock-id', ...entity, updatedAt: new Date() })),
  save: jest.fn(entity => ({ ...entity, id: entity.id || 'mock-id', updatedAt: new Date() })),
  createQueryBuilder: jest.fn(queryBuilder),
});

const mockDataSource = () => ({
  transaction: jest.fn(async (cb: any) => cb({ query: jest.fn() })),
});

describe('SyncService', () => {
  let service: SyncService;
  let expenseRepo: any;
  let budgetRepo: any;
  let accountRepo: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncService,
        { provide: getRepositoryToken(Expense), useFactory: mockRepository },
        { provide: getRepositoryToken(Loan), useFactory: mockRepository },
        { provide: getRepositoryToken(Investment), useFactory: mockRepository },
        { provide: getRepositoryToken(Budget), useFactory: mockRepository },
        { provide: getRepositoryToken(CategoryRule), useFactory: mockRepository },
        { provide: getRepositoryToken(Account), useFactory: mockRepository },
        { provide: getRepositoryToken(Category), useFactory: mockRepository },
        { provide: DataSource, useFactory: mockDataSource },
      ],
    }).compile();

    service = module.get<SyncService>(SyncService);
    expenseRepo = module.get(getRepositoryToken(Expense));
    budgetRepo = module.get(getRepositoryToken(Budget));
    accountRepo = module.get(getRepositoryToken(Account));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processBatch - CREATE', () => {
    it('should create and save a new record if it does not exist', async () => {
      expenseRepo.findOne.mockResolvedValue(null);
      accountRepo.findOne.mockResolvedValue({ id: 'default_bank', userId: 'user-1' });

      const operations = [
        {
          clientId: 'client-uuid-1',
          operationType: 'CREATE',
          clientVersion: 1,
          payload: {
            amount: 100,
            category: 'Food',
            note: 'Dinner',
            date: '2026-07-18T20:30:00.000Z',
            method: 'UPI',
            source: 'MANUAL',
            merchant: 'Restaurant',
            accountId: 'default_bank',
            isCountedAsSpend: true,
          },
        },
      ];

      const result = await service.processBatch('user-1', 'expense', operations);

      expect(result).toHaveLength(1);
      expect(result[0].clientId).toBe('client-uuid-1');
      expect(result[0].status).toBe('applied');
      expect(result[0].serverVersion).toBe(1);
      expect(expenseRepo.create).toHaveBeenCalled();
      expect(expenseRepo.save).toHaveBeenCalled();
    });

    it('derives category ids from a legacy category name', async () => {
      expenseRepo.findOne.mockResolvedValue(null);
      accountRepo.findOne.mockResolvedValue({ id: 'default_bank', userId: 'user-1' });

      await service.processBatch('user-1', 'expense', [
        {
          clientId: 'c-legacy',
          operationType: 'CREATE',
          clientVersion: 1,
          payload: { amount: 250, category: 'Food Delivery', date: '2026-07-18T20:30:00.000Z' },
        },
      ]);

      expect(expenseRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ categoryId: 'food', subcategoryId: 'food.delivery' }),
      );
    });

    it('keeps category ids sent by new clients', async () => {
      expenseRepo.findOne.mockResolvedValue(null);
      accountRepo.findOne.mockResolvedValue({ id: 'default_bank', userId: 'user-1' });

      await service.processBatch('user-1', 'expense', [
        {
          clientId: 'c-new',
          operationType: 'CREATE',
          clientVersion: 1,
          payload: { amount: 250, category: 'Food & Drinks', categoryId: 'food', subcategoryId: 'food.cafe', date: '2026-07-18T20:30:00.000Z' },
        },
      ]);

      expect(expenseRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ categoryId: 'food', subcategoryId: 'food.cafe' }),
      );
    });

    it('treats a replayed CREATE (e.g. SMS re-import after reinstall) as idempotent: server copy wins', async () => {
      accountRepo.findOne.mockResolvedValue({ id: 'default_bank', userId: 'user-1' });
      const existingExpense = {
        id: 'server-id-1',
        clientId: 'client-uuid-1',
        userId: 'user-1',
        amount: 200, // different amount
        category: 'Food',
        note: 'Dinner',
        date: new Date('2026-07-18T20:30:00.000Z'),
        method: 'UPI',
        source: 'MANUAL',
        merchant: 'Restaurant',
        accountId: 'default_bank',
        isCountedAsSpend: true,
        version: 1,
        isDeleted: false,
        updatedAt: new Date(),
      };

      expenseRepo.findOne.mockResolvedValue(existingExpense);

      const operations = [
        {
          clientId: 'client-uuid-1',
          operationType: 'CREATE',
          clientVersion: 1,
          payload: {
            amount: 100, // diverged amount
            category: 'Food',
            note: 'Dinner',
            date: '2026-07-18T20:30:00.000Z',
            method: 'UPI',
            source: 'MANUAL',
            merchant: 'Restaurant',
            accountId: 'default_bank',
            isCountedAsSpend: true,
          },
        },
      ];

      const result = await service.processBatch('user-1', 'expense', operations);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('applied');
      expect(result[0].serverId).toBe('server-id-1');
      expect(result[0].isDeleted).toBe(false);
      expect(result[0].serverPayload.amount).toBe(200);
      expect(expenseRepo.save).not.toHaveBeenCalled();
    });

    it('does not resurrect a record the user deleted', async () => {
      accountRepo.findOne.mockResolvedValue({ id: 'default_bank', userId: 'user-1' });
      const deleted = { id: 's-2', clientId: 'c-2', userId: 'user-1', amount: 100, version: 3, isDeleted: true, updatedAt: new Date() };
      expenseRepo.findOne.mockResolvedValue(deleted);

      const result = await service.processBatch('user-1', 'expense', [
        { clientId: 'c-2', operationType: 'CREATE', clientVersion: 1, payload: { amount: 100, category: 'Food' } },
      ]);

      expect(result[0].status).toBe('applied');
      expect(result[0].isDeleted).toBe(true);
      expect(result[0].serverPayload).toBeUndefined();
      expect(deleted.isDeleted).toBe(true);
      expect(expenseRepo.save).not.toHaveBeenCalled();
    });

    it('applies a CREATE whose local version is newer (edited before the first push was acknowledged)', async () => {
      accountRepo.findOne.mockResolvedValue({ id: 'default_bank', userId: 'user-1' });
      const existing: any = { id: 's-3', clientId: 'c-3', userId: 'user-1', amount: 100, version: 1, isDeleted: false, updatedAt: new Date() };
      expenseRepo.findOne.mockResolvedValue(existing);

      const result = await service.processBatch('user-1', 'expense', [
        { clientId: 'c-3', operationType: 'CREATE', clientVersion: 2, payload: { amount: 120, category: 'Food' } },
      ]);

      expect(result[0].status).toBe('applied');
      expect(existing.amount).toBe(120);
      expect(existing.version).toBe(2);
    });
  });

  describe('pull', () => {
    it('pages with a compound cursor and reports hasMore', async () => {
      const t = new Date('2026-09-01T10:00:00.000Z');
      const rows = [1, 2, 3].map((i) => ({
        id: `id-${i}`, clientId: `c-${i}`, version: 1, isDeleted: false, updatedAt: t,
        amount: i, category: 'Food', date: t, createdAt: t,
      }));
      const qb = queryBuilder();
      qb.getMany.mockResolvedValue(rows);
      expenseRepo.createQueryBuilder.mockReturnValue(qb);

      const res = await service.pull('user-1', 'expense', '2026-09-01T09:00:00.000Z|id-0', 2);

      expect(res.records).toHaveLength(2);
      expect(res.hasMore).toBe(true);
      expect(res.nextCursor).toBe(`${t.toISOString()}|id-2`);
      expect(qb.limit).toHaveBeenCalledWith(3);
      expect(qb.andWhere.mock.calls[0][1]).toEqual({ sinceDate: new Date('2026-09-01T09:00:00.000Z'), sinceId: 'id-0' });
    });
  });

  describe('processBatch - Account Sync', () => {
    it('should create an account entity in sync batch', async () => {
      accountRepo.findOne.mockResolvedValue(null);

      const operations = [
        {
          clientId: 'acc-client-1',
          operationType: 'CREATE',
          clientVersion: 1,
          payload: {
            id: 'acc_hdfc_1234',
            name: 'HDFC Salary Account',
            type: 'bank',
            currentBalance: 50000,
            creditLimit: 0,
            accountNumberLast4: '4321',
            colorValue: 4280962800,
          },
        },
      ];

      const result = await service.processBatch('user-1', 'account', operations);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('applied');
      expect(accountRepo.save).toHaveBeenCalled();
    });
  });

  describe('processBatch - UPDATE', () => {
    it('should upsert the record if it does not exist', async () => {
      expenseRepo.findOne.mockResolvedValue(null);
      accountRepo.findOne.mockResolvedValue({ id: 'default_bank', userId: 'user-1' });

      const operations = [
        {
          clientId: 'client-uuid-2',
          operationType: 'UPDATE',
          clientVersion: 1,
          payload: {
            amount: 50,
            category: 'Travel',
            isCountedAsSpend: false,
          },
        },
      ];

      const result = await service.processBatch('user-1', 'expense', operations);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('applied');
      expect(expenseRepo.save).toHaveBeenCalled();
    });
  });

  describe('processBatch - DELETE', () => {
    it('should mark an existing record as soft deleted', async () => {
      const existingExpense = {
        id: 'server-id-1',
        clientId: 'client-uuid-1',
        userId: 'user-1',
        amount: 100,
        version: 1,
        isDeleted: false,
        updatedAt: new Date(),
      };

      expenseRepo.findOne.mockResolvedValue(existingExpense);

      const operations = [
        {
          clientId: 'client-uuid-1',
          operationType: 'DELETE',
          clientVersion: 2,
        },
      ];

      const result = await service.processBatch('user-1', 'expense', operations);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('applied');
      expect(existingExpense.isDeleted).toBe(true);
      expect(existingExpense.version).toBe(2);
      expect(expenseRepo.save).toHaveBeenCalledWith(existingExpense);
    });
  });

  describe('processBatch - Budget Unique Constraint Lookup', () => {
    it('should find budget by month and category if clientId search yields no record', async () => {
      const existingBudget = {
        id: 'server-budget-id',
        clientId: 'old-client-id',
        userId: 'user-1',
        month: '2026-07',
        category: 'Other',
        limit: 3000,
        version: 1,
        isDeleted: false,
        updatedAt: new Date(),
      };

      budgetRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(existingBudget);

      const operations = [
        {
          clientId: 'new-client-id',
          operationType: 'CREATE',
          clientVersion: 2,
          payload: {
            month: '2026-07',
            category: 'Other',
            limit: 5000,
          },
        },
      ];

      const result = await service.processBatch('user-1', 'budget', operations);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('applied');
      expect(existingBudget.clientId).toBe('new-client-id');
      expect(existingBudget.version).toBe(2);
      expect(budgetRepo.save).toHaveBeenCalledWith(existingBudget);
    });
  });
});
