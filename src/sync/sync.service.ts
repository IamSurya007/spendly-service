import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Expense } from '../database/entities/expense.entity';
import { Loan } from '../database/entities/loan.entity';
import { Investment } from '../database/entities/investment.entity';
import { Budget } from '../database/entities/budget.entity';
import { CategoryRule } from '../database/entities/category-rule.entity';
import { Account } from '../database/entities/account.entity';
import { Category } from '../database/entities/category.entity';
import { resolveLegacyCategory, SYSTEM_BY_ID } from '../categories/category-resolver';
import { LEGACY_CATEGORY_MAP } from '../categories/taxonomy.generated';

const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : d);

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
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
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
      case 'account':
        return this.accountRepo;
      case 'category':
        return this.categoryRepo;
      default:
        throw new BadRequestException(`Invalid entity type: ${entityType}`);
    }
  }

  /**
   * Budgets are keyed by parent category id. Older clients send a legacy
   * name ("Groceries"); custom categories are UUIDs and are kept as-is.
   */
  private normalizeBudgetCategory(category: string | undefined): string {
    const value = (category ?? '').trim();
    const system = SYSTEM_BY_ID.get(value);
    if (system) return system.parentId ?? system.id;
    const lower = value.toLowerCase();
    const isKnownName =
      LEGACY_CATEGORY_MAP[lower] !== undefined ||
      [...SYSTEM_BY_ID.values()].some((c) => c.name.toLowerCase() === lower);
    return isKnownName ? resolveLegacyCategory(value).categoryId : value || 'misc';
  }

  private mapPayloadToFields(entityType: string, payload: any): any {
    if (!payload) return {};
    switch (entityType) {
      case 'expense': {
        const isCountedAsSpend = payload.isCountedAsSpend !== undefined
          ? Boolean(payload.isCountedAsSpend)
          : (payload.is_counted_as_spend !== undefined ? Boolean(payload.is_counted_as_spend) : true);
        const amount = typeof payload.amount === 'string' ? parseFloat(payload.amount) : (payload.amount || 0);
        const derived = payload.categoryId
          ? { categoryId: payload.categoryId, subcategoryId: payload.subcategoryId || null }
          : resolveLegacyCategory(payload.category, amount < 0);
        return {
          amount,
          category: payload.category || SYSTEM_BY_ID.get(derived.categoryId)?.name || 'Other',
          categoryId: derived.categoryId,
          subcategoryId: derived.subcategoryId || null,
          subcategory: payload.subcategory || null,
          note: payload.note || null,
          date: payload.date ? new Date(payload.date) : new Date(),
          method: payload.method || 'UPI',
          source: payload.source || 'MANUAL',
          merchant: payload.merchant || null,
          accountId: payload.accountId || 'default_bank',
          isCountedAsSpend,
          createdAt: payload.createdAt ? new Date(payload.createdAt) : undefined,
        };
      }
      case 'account':
        return {
          id: payload.id || undefined,
          name: payload.name || 'Primary Bank Account',
          type: payload.type || 'bank',
          currentBalance: typeof payload.currentBalance === 'string' ? parseFloat(payload.currentBalance) : (payload.currentBalance || 0),
          creditLimit: typeof payload.creditLimit === 'string' ? parseFloat(payload.creditLimit) : (payload.creditLimit || 0),
          accountNumberLast4: payload.accountNumberLast4 || null,
          colorValue: typeof payload.colorValue === 'string' ? parseInt(payload.colorValue, 10) : (payload.colorValue !== undefined ? payload.colorValue : 4280962800),
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
          // The mobile app does not send a rate for investments: leave the
          // stored value alone (undefined is skipped by TypeORM on save).
          interestRate: payload.interestRate === undefined
            ? undefined
            : (typeof payload.interestRate === 'string' ? parseFloat(payload.interestRate) : (payload.interestRate || 0)),
          startDate: payload.startDate ? new Date(payload.startDate) : new Date(),
          maturityDate: payload.maturityDate ? new Date(payload.maturityDate) : new Date(),
          institution: payload.institution || null,
          createdAt: payload.createdAt ? new Date(payload.createdAt) : undefined,
        };
      case 'budget':
        return {
          month: payload.month || '',
          category: this.normalizeBudgetCategory(payload.category),
          limit: typeof payload.limit === 'string' ? parseFloat(payload.limit) : (payload.limit || 0),
          createdAt: payload.createdAt ? new Date(payload.createdAt) : undefined,
        };
      case 'category_rule': {
        const derived = payload.categoryId
          ? { categoryId: payload.categoryId, subcategoryId: payload.subcategoryId || null }
          : resolveLegacyCategory(payload.category);
        return {
          merchant: payload.merchant || '',
          category: payload.category || SYSTEM_BY_ID.get(derived.categoryId)?.name || 'Other',
          categoryId: derived.categoryId,
          subcategoryId: derived.subcategoryId || null,
          createdAt: payload.createdAt ? new Date(payload.createdAt) : undefined,
        };
      }
      case 'category':
        return {
          name: (payload.name || 'Category').toString().slice(0, 64),
          icon: payload.icon || 'tag',
          color: /^#[0-9a-fA-F]{6}$/.test(payload.color ?? '') ? payload.color : '#9CA3AF',
          kind: ['expense', 'income', 'transfer'].includes(payload.kind) ? payload.kind : 'expense',
          parentId: payload.parentId || null,
          isSystem: Boolean(payload.isSystem),
          isHidden: Boolean(payload.isHidden),
          sortOrder: typeof payload.sortOrder === 'number' ? Math.trunc(payload.sortOrder) : 0,
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
          categoryId: record.categoryId || '',
          subcategoryId: record.subcategoryId || '',
          subcategory: record.subcategory || '',
          note: record.note || '',
          date: iso(record.date),
          method: record.method,
          source: record.source,
          merchant: record.merchant || '',
          accountId: record.accountId || 'default_bank',
          isCountedAsSpend: record.isCountedAsSpend ?? true,
          createdAt: iso(record.createdAt),
        };
      case 'account':
        return {
          id: record.id,
          name: record.name,
          type: record.type,
          currentBalance: record.currentBalance,
          creditLimit: record.creditLimit,
          accountNumberLast4: record.accountNumberLast4 || '',
          colorValue: record.colorValue,
          createdAt: iso(record.createdAt),
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
          createdAt: iso(record.createdAt),
        };
      case 'investment':
        return {
          type: record.type,
          name: record.name,
          monthlyAmount: record.monthlyAmount,
          principal: record.principal,
          maturityAmount: record.maturityAmount,
          durationMonths: record.durationMonths,
          interestRate: record.interestRate ?? 0,
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
          categoryId: record.categoryId || '',
          subcategoryId: record.subcategoryId || '',
        };
      case 'category':
        return {
          name: record.name,
          icon: record.icon,
          color: record.color,
          kind: record.kind,
          parentId: record.parentId,
          isSystem: record.isSystem,
          isHidden: record.isHidden,
          sortOrder: record.sortOrder,
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
          category: this.normalizeBudgetCategory(payload.category),
        },
      });
    } else if (entityType === 'account' && payload?.id) {
      record = await repo.findOne({
        where: {
          id: payload.id,
          userId,
        },
      });
    }
    return record;
  }

  private async ensureAccountExists(userId: string, accountId: string): Promise<boolean> {
    const existing = await this.accountRepo.findOne({
      where: [
        { id: accountId, userId },
        { clientId: accountId, userId },
      ],
    });
    if (existing) return true;

    if (accountId === 'default_bank') {
      const defaultAcc = this.accountRepo.create({
        id: 'default_bank',
        userId,
        name: 'Default Bank Account',
        type: 'bank',
        currentBalance: 0,
        creditLimit: 0,
        accountNumberLast4: '0000',
        colorValue: 4280962800,
        version: 1,
        isDeleted: false,
      });
      await this.accountRepo.save(defaultAcc);
      return true;
    }
    return false;
  }

  private applied(clientId: string, record: any, extra: Record<string, unknown> = {}) {
    return {
      clientId,
      status: 'applied',
      serverId: record.id,
      serverVersion: record.version,
      serverUpdatedAt: record.updatedAt ? record.updatedAt.toISOString() : new Date().toISOString(),
      ...extra,
    };
  }

  async processBatch(userId: string, entityType: string, operations: any[]): Promise<any[]> {
    const repo = this.getRepository(entityType);

    // Serialise batches per user + entity type. Two overlapping batches with
    // the same clientId (retry racing the original request) could otherwise
    // both miss `findExistingRecord` and insert duplicate rows. The lock is
    // released when the (otherwise empty) transaction ends.
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`sync:${userId}:${entityType}`]);
      const results: any[] = [];
      for (const op of operations) {
        results.push(await this.processOperation(repo, userId, entityType, op));
      }
      return results;
    });
  }

  private async processOperation(repo: Repository<any>, userId: string, entityType: string, op: any): Promise<any> {
    const { clientId, operationType, clientVersion, payload } = op;
    if (!clientId) {
      return { clientId, status: 'rejected' };
    }

    if (entityType === 'expense' && (operationType === 'CREATE' || operationType === 'UPDATE')) {
      const targetAccountId = payload?.accountId || 'default_bank';
      const validAccount = await this.ensureAccountExists(userId, targetAccountId);
      if (!validAccount) {
        return { clientId, status: 'rejected' };
      }
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
          return this.applied(clientId, entity);
        }

        // The record already exists. A CREATE whose version is not newer than
        // the server's is a replay: a retry, or the same record created again
        // after a reinstall (SMS re-import, re-created SMS account). That is
        // idempotent: the server copy wins and is sent back, and a record the
        // user deleted stays deleted.
        if ((clientVersion || 1) <= (existing.version || 1)) {
          return this.applied(clientId, existing, {
            isDeleted: Boolean(existing.isDeleted),
            serverPayload: existing.isDeleted ? undefined : this.getPayload(entityType, existing),
          });
        }

        // Newer local version (edited before the first push was acknowledged).
        const mapped = this.mapPayloadToFields(entityType, payload);
        Object.assign(existing, mapped);
        existing.clientId = clientId;
        existing.version = (existing.version || 1) + 1;
        existing.updatedAt = new Date();
        await repo.save(existing);
        return this.applied(clientId, existing);
      }

      if (operationType === 'UPDATE') {
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
          return this.applied(clientId, entity);
        }

        const diverged = this.hasDiverged(entityType, existing, payload);
        if (existing.version >= (clientVersion || 1) && diverged) {
          return {
            clientId,
            status: 'conflict',
            remotePayload: this.getPayload(entityType, existing),
          };
        }
        const mapped = this.mapPayloadToFields(entityType, payload);
        Object.assign(existing, mapped);
        existing.clientId = clientId; // Associate this clientId with the record
        existing.version = (existing.version || 1) + 1;
        existing.isDeleted = false;
        existing.updatedAt = new Date();
        await repo.save(existing);
        return this.applied(clientId, existing);
      }

      if (operationType === 'DELETE') {
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
          return this.applied(clientId, entity);
        }
        existing.isDeleted = true;
        existing.clientId = clientId; // Associate this clientId with the record
        existing.version = (existing.version || 1) + 1;
        existing.updatedAt = new Date();
        await repo.save(existing);
        return this.applied(clientId, existing);
      }

      return { clientId, status: 'rejected' };
    } catch (err) {
      console.error(`Sync error on operation:`, op, err);
      return { clientId, status: 'rejected' };
    }
  }

  /**
   * Cursor format: `<ISO updatedAt>|<id>`. The id tie-breaker makes paging
   * exact when several rows share an updatedAt (bulk imports), which a plain
   * `updatedAt > since` cursor skipped at page boundaries. A bare ISO date
   * from older clients is still accepted.
   */
  async pull(userId: string, entityType: string, since?: string, limit: number = 200): Promise<any> {
    const repo = this.getRepository(entityType);
    const pageSize = Math.min(Math.max(limit || 200, 1), 500);

    // Postgres keeps microseconds, JS dates (and so the cursor) only
    // milliseconds: compare and order on the millisecond-truncated value, or
    // rows within the same millisecond would be skipped or repeated.
    const updatedMs = `date_trunc('milliseconds', "entity"."updatedAt")`;

    const queryBuilder = repo.createQueryBuilder('entity')
      .where('entity.userId = :userId', { userId });

    if (since) {
      const [datePart, idPart] = since.split('|');
      const sinceDate = new Date(datePart);
      if (!isNaN(sinceDate.getTime())) {
        if (idPart) {
          queryBuilder.andWhere(
            `(${updatedMs} > :sinceDate OR (${updatedMs} = :sinceDate AND "entity"."id" > :sinceId))`,
            { sinceDate, sinceId: idPart },
          );
        } else {
          queryBuilder.andWhere(`${updatedMs} > :sinceDate`, { sinceDate });
        }
      }
    }

    queryBuilder
      .orderBy(updatedMs, 'ASC')
      .addOrderBy('entity.id', 'ASC')
      .limit(pageSize + 1);

    const fetched = await queryBuilder.getMany();
    const hasMore = fetched.length > pageSize;
    const records = hasMore ? fetched.slice(0, pageSize) : fetched;

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

    let nextCursor = since ?? null;
    if (records.length > 0) {
      const last = records[records.length - 1];
      nextCursor = `${last.updatedAt.toISOString()}|${last.id}`;
    }

    return {
      records: formattedRecords,
      tombstones,
      nextCursor,
      hasMore,
    };
  }
}
