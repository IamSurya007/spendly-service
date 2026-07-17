import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { SyncService } from './sync.service';
import { Expense } from '../database/entities/expense.entity';
import { Loan } from '../database/entities/loan.entity';
import { Investment } from '../database/entities/investment.entity';
import { Budget } from '../database/entities/budget.entity';
import { CategoryRule } from '../database/entities/category-rule.entity';

const mockRepository = () => ({
  findOne: jest.fn(),
  create: jest.fn(entity => ({ id: 'mock-id', ...entity, updatedAt: new Date() })),
  save: jest.fn(entity => ({ ...entity, id: entity.id || 'mock-id', updatedAt: new Date() })),
  createQueryBuilder: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    take: jest.fn().mockReturnThis(),
    getMany: jest.fn().mockResolvedValue([]),
  })),
});

describe('SyncService', () => {
  let service: SyncService;
  let expenseRepo: any;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncService,
        { provide: getRepositoryToken(Expense), useFactory: mockRepository },
        { provide: getRepositoryToken(Loan), useFactory: mockRepository },
        { provide: getRepositoryToken(Investment), useFactory: mockRepository },
        { provide: getRepositoryToken(Budget), useFactory: mockRepository },
        { provide: getRepositoryToken(CategoryRule), useFactory: mockRepository },
      ],
    }).compile();

    service = module.get<SyncService>(SyncService);
    expenseRepo = module.get(getRepositoryToken(Expense));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processBatch - CREATE', () => {
    it('should create and save a new record if it does not exist', async () => {
      expenseRepo.findOne.mockResolvedValue(null);

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

    it('should return conflict if record already exists and has diverged', async () => {
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
          },
        },
      ];

      const result = await service.processBatch('user-1', 'expense', operations);

      expect(result).toHaveLength(1);
      expect(result[0].status).toBe('conflict');
      expect(result[0].remotePayload.amount).toBe(200);
    });
  });

  describe('processBatch - UPDATE', () => {
    it('should upsert the record if it does not exist', async () => {
      expenseRepo.findOne.mockResolvedValue(null);

      const operations = [
        {
          clientId: 'client-uuid-2',
          operationType: 'UPDATE',
          clientVersion: 1,
          payload: {
            amount: 50,
            category: 'Travel',
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
});
