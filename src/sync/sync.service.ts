import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Expense } from '../database/entities/expense.entity';
import { Loan } from '../database/entities/loan.entity';
import { Investment } from '../database/entities/investment.entity';
import { Budget } from '../database/entities/budget.entity';
import { CategoryRule } from '../database/entities/category-rule.entity';

@Injectable()
export class SyncService {
  constructor(
    @InjectRepository(Expense)
    private readonly expenseRepo: Repository<Expense>,
    @InjectRepository(Loan)
    private readonly loanRepo: Repository<Loan>,
    @InjectRepository(Investment)
    private readonly investmentRepo: Repository<Investment>,
    @InjectRepository(Budget)
    private readonly budgetRepo: Repository<Budget>,
    @InjectRepository(CategoryRule)
    private readonly categoryRuleRepo: Repository<CategoryRule>,
  ) {}

  private getRepository(entityType: string): Repository<any> {
    switch (entityType) {
      case 'expense':
        return this.expenseRepo;
      case 'loan':
        return this.loanRepo;
      case 'investment':
        return this.investmentRepo;
      case 'budget':
        return this.budgetRepo;
      case 'category_rule':
        return this.categoryRuleRepo;
      default:
        throw new BadRequestException(`Invalid entity type: ${entityType}`);
    }
  }

  private mapPayloadToFields(entityType: string, payload: any): any {
    if (!payload) return {};
    switch (entityType) {
      case 'expense':
        return {
          amount: typeof payload.amount === 'string' ? parseFloat(payload.amount) : (payload.amount || 0),
          category: payload.category || 'Other',
          note: payload.note || null,
          date: payload.date ? new Date(payload.date) : new Date(),
          method: payload.method || 'UPI',
          source: payload.source || 'MANUAL',
          merchant: payload.merchant || null,
          createdAt: payload.createdAt ? new Date(payload.createdAt) : undefined,
        };
      case 'loan':
        return {
          type: payload.type || 'TAKEN',
          name: payload.name || 'Friend',
          principal: typeof payload.principal === 'string' ? parseFloat(payload.principal) : (payload.principal || 0),
          total: typeof payload.total === 'string' ? parseFloat(payload.total) : (payload.total || 0),
          interestRate: typeof payload.interestRate === 'string' ? parseFloat(payload.interestRate) : (payload.interestRate || 0),
          repaymentDate: payload.repaymentDate ? new Date(payload.repaymentDate) : null,
          status: payload.status || 'ACTIVE',
          notes: payload.notes || null,
          createdAt: payload.createdAt ? new Date(payload.createdAt) : undefined,
        };
      case 'investment':
        return {
          type: payload.type || 'RD',
          name: payload.name || 'Investment',
          monthlyAmount: typeof payload.monthlyAmount === 'string' ? parseFloat(payload.monthlyAmount) : (payload.monthlyAmount || 0),
          principal: typeof payload.principal === 'string' ? parseFloat(payload.principal) : (payload.principal || 0),
          maturityAmount: typeof payload.maturityAmount === 'string' ? parseFloat(payload.maturityAmount) : (payload.maturityAmount || 0),
          durationMonths: typeof payload.durationMonths === 'string' ? parseInt(payload.durationMonths, 10) : (payload.durationMonths || 12),
          startDate: payload.startDate ? new Date(payload.startDate) : new Date(),
          maturityDate: payload.maturityDate ? new Date(payload.maturityDate) : new Date(),
          institution: payload.institution || null,
          createdAt: payload.createdAt ? new Date(payload.createdAt) : undefined,
        };
      case 'budget':
        return {
          month: payload.month || '',
          category: payload.category || 'Other',
          limit: typeof payload.limit === 'string' ? parseFloat(payload.limit) : (payload.limit || 0),
          createdAt: payload.createdAt ? new Date(payload.createdAt) : undefined,
        };
      case 'category_rule':
        return {
          merchant: payload.merchant || '',
          category: payload.category || 'Other',
          createdAt: payload.createdAt ? new Date(payload.createdAt) : undefined,
        };
      default:
        return {};
    }
  }

  private getPayload(entityType: string, record: any): any {
    if (!record) return {};
    switch (entityType) {
      case 'expense':
        return {
          amount: record.amount,
          category: record.category,
          note: record.note || '',
          date: record.date instanceof Date ? record.date.toISOString() : record.date,
          method: record.method,
          source: record.source,
          merchant: record.merchant || '',
          createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : record.createdAt,
        };
      case 'loan':
        return {
          type: record.type,
          name: record.name,
          principal: record.principal,
          total: record.total,
          interestRate: record.interestRate,
          repaymentDate: record.repaymentDate instanceof Date 
            ? record.repaymentDate.toISOString().substring(0, 10) 
            : (record.repaymentDate ? record.repaymentDate.substring(0, 10) : null),
          status: record.status,
          notes: record.notes || '',
          createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : record.createdAt,
        };
      case 'investment':
        return {
          type: record.type,
          name: record.name,
          monthlyAmount: record.monthlyAmount,
          principal: record.principal,
          maturityAmount: record.maturityAmount,
          durationMonths: record.durationMonths,
          startDate: record.startDate instanceof Date 
            ? record.startDate.toISOString().substring(0, 10) 
            : (record.startDate ? record.startDate.substring(0, 10) : ''),
          maturityDate: record.maturityDate instanceof Date 
            ? record.maturityDate.toISOString().substring(0, 10) 
            : (record.maturityDate ? record.maturityDate.substring(0, 10) : ''),
          institution: record.institution || '',
        };
      case 'budget':
        return {
          month: record.month,
          category: record.category,
          limit: record.limit,
        };
      case 'category_rule':
        return {
          merchant: record.merchant,
          category: record.category,
        };
      default:
        return {};
    }
  }

  private hasDiverged(entityType: string, serverRecord: any, payload: any): boolean {
    if (!payload) return false;
    const mapped = this.mapPayloadToFields(entityType, payload);
    for (const key of Object.keys(mapped)) {
      const serverVal = serverRecord[key];
      const incomingVal = mapped[key];
      if (serverVal === undefined || incomingVal === undefined) continue;

      if (serverVal instanceof Date || (serverVal && typeof serverVal === 'object' && serverVal.getTime)) {
        const serverTime = new Date(serverVal).getTime();
        const incomingTime = incomingVal ? new Date(incomingVal).getTime() : 0;
        if (Math.abs(serverTime - incomingTime) > 1000) {
          return true;
        }
        continue;
      }

      if (serverVal !== incomingVal) {
        if (!serverVal && !incomingVal) continue;
        if (typeof serverVal === 'number' && typeof incomingVal === 'number') {
          if (serverVal !== incomingVal) return true;
          continue;
        }
        return true;
      }
    }
    return false;
  }

  private async findExistingRecord(
    repo: Repository<any>,
    entityType: string,
    userId: string,
    clientId: string,
    payload: any,
  ): Promise<any> {
    let record = await repo.findOne({ where: { userId, clientId } });
    if (record) return record;

    if (entityType === 'budget' && payload?.month && payload?.category) {
      record = await repo.findOne({
        where: {
          userId,
          month: payload.month,
          category: payload.category,
        },
      });
    }
    return record;
  }

  async processBatch(userId: string, entityType: string, operations: any[]): Promise<any[]> {
    const repo = this.getRepository(entityType);
    const results: any[] = [];

    for (const op of operations) {
      const { clientId, operationType, clientVersion, payload } = op;
      if (!clientId) {
        results.push({
          clientId,
          status: 'rejected',
        });
        continue;
      }

      try {
        const existing = await this.findExistingRecord(repo, entityType, userId, clientId, payload);

        if (operationType === 'CREATE') {
          if (!existing) {
            const mapped = this.mapPayloadToFields(entityType, payload);
            const entity = repo.create({
              ...mapped,
              userId,
              clientId,
              version: 1,
              isDeleted: false,
            });
            await repo.save(entity);
            results.push({
              clientId,
              status: 'applied',
              serverId: entity.id,
              serverVersion: 1,
              serverUpdatedAt: entity.updatedAt ? entity.updatedAt.toISOString() : new Date().toISOString(),
            });
          } else {
            // Already exists - run concurrency/update check
            const diverged = this.hasDiverged(entityType, existing, payload);
            if (existing.version >= (clientVersion || 1) && diverged) {
              results.push({
                clientId,
                status: 'conflict',
                remotePayload: this.getPayload(entityType, existing),
              });
            } else {
              const mapped = this.mapPayloadToFields(entityType, payload);
              Object.assign(existing, mapped);
              existing.clientId = clientId; // Associate this clientId with the record
              existing.version = (existing.version || 1) + 1;
              existing.isDeleted = false;
              existing.updatedAt = new Date();
              await repo.save(existing);
              results.push({
                clientId,
                status: 'applied',
                serverId: existing.id,
                serverVersion: existing.version,
                serverUpdatedAt: existing.updatedAt.toISOString(),
              });
            }
          }
        } else if (operationType === 'UPDATE') {
          if (!existing) {
            // Upsert if not found
            const mapped = this.mapPayloadToFields(entityType, payload);
            const entity = repo.create({
              ...mapped,
              userId,
              clientId,
              version: clientVersion || 1,
              isDeleted: false,
            });
            await repo.save(entity);
            results.push({
              clientId,
              status: 'applied',
              serverId: entity.id,
              serverVersion: entity.version,
              serverUpdatedAt: entity.updatedAt ? entity.updatedAt.toISOString() : new Date().toISOString(),
            });
          } else {
            const diverged = this.hasDiverged(entityType, existing, payload);
            if (existing.version >= (clientVersion || 1) && diverged) {
              results.push({
                clientId,
                status: 'conflict',
                remotePayload: this.getPayload(entityType, existing),
              });
            } else {
              const mapped = this.mapPayloadToFields(entityType, payload);
              Object.assign(existing, mapped);
              existing.clientId = clientId; // Associate this clientId with the record
              existing.version = (existing.version || 1) + 1;
              existing.isDeleted = false;
              existing.updatedAt = new Date();
              await repo.save(existing);
              results.push({
                clientId,
                status: 'applied',
                serverId: existing.id,
                serverVersion: existing.version,
                serverUpdatedAt: existing.updatedAt.toISOString(),
              });
            }
          }
        } else if (operationType === 'DELETE') {
          if (!existing) {
            // If doesn't exist, create it as soft-deleted to keep tombstone
            const mapped = this.mapPayloadToFields(entityType, payload);
            const entity = repo.create({
              ...mapped,
              userId,
              clientId,
              version: clientVersion || 1,
              isDeleted: true,
            });
            await repo.save(entity);
            results.push({
              clientId,
              status: 'applied',
              serverId: entity.id,
              serverVersion: entity.version,
              serverUpdatedAt: entity.updatedAt ? entity.updatedAt.toISOString() : new Date().toISOString(),
            });
          } else {
            existing.isDeleted = true;
            existing.clientId = clientId; // Associate this clientId with the record
            existing.version = (existing.version || 1) + 1;
            existing.updatedAt = new Date();
            await repo.save(existing);
            results.push({
              clientId,
              status: 'applied',
              serverId: existing.id,
              serverVersion: existing.version,
              serverUpdatedAt: existing.updatedAt.toISOString(),
            });
          }
        } else {
          results.push({
            clientId,
            status: 'rejected',
          });
        }
      } catch (err) {
        console.error(`Sync error on operation:`, op, err);
        results.push({
          clientId,
          status: 'rejected',
        });
      }
    }

    return results;
  }

  async pull(userId: string, entityType: string, since?: string, limit: number = 200): Promise<any> {
    const repo = this.getRepository(entityType);

    const queryBuilder = repo.createQueryBuilder('entity')
      .where('entity.userId = :userId', { userId });

    if (since) {
      const sinceDate = new Date(since);
      if (!isNaN(sinceDate.getTime())) {
        queryBuilder.andWhere('entity.updatedAt > :sinceDate', { sinceDate });
      }
    }

    queryBuilder
      .orderBy('entity.updatedAt', 'ASC')
      .take(limit);

    const records = await queryBuilder.getMany();

    const activeRecords = records.filter(r => !r.isDeleted);
    const deletedRecords = records.filter(r => r.isDeleted);

    const formattedRecords = activeRecords.map(r => {
      const payload = this.getPayload(entityType, r);
      return {
        id: r.id,
        clientId: r.clientId,
        version: r.version,
        updatedAt: r.updatedAt.toISOString(),
        isDeleted: false,
        payload,
        ...payload,
      };
    });

    const tombstones = deletedRecords.map(r => r.clientId).filter(cid => !!cid);

    let nextCursor = new Date().toISOString();
    if (records.length > 0) {
      const latestRecord = records[records.length - 1];
      nextCursor = latestRecord.updatedAt.toISOString();
    }

    return {
      records: formattedRecords,
      tombstones,
      nextCursor,
    };
  }
}
