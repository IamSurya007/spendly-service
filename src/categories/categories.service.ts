import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import { Category } from '../database/entities/category.entity';
import { Budget } from '../database/entities/budget.entity';
import {
  CATEGORY_COLOR_PALETTE,
  CATEGORY_ICON_PALETTE,
  DEFAULT_CREDIT_CATEGORY_ID,
  DEFAULT_DEBIT_CATEGORY_ID,
  LEGACY_CATEGORY_MAP,
  SYSTEM_CATEGORIES,
} from './taxonomy.generated';
import { CategoryNames, resolveLegacyCategory, SYSTEM_BY_ID } from './category-resolver';

export interface EffectiveCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
  kind: string;
  parentId: string | null;
  isSystem: boolean;
  isHidden: boolean;
  sortOrder: number;
}

@Injectable()
export class CategoriesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(CategoriesService.name);

  constructor(
    @InjectRepository(Category)
    private readonly categoryRepo: Repository<Category>,
    @InjectRepository(Budget)
    private readonly budgetRepo: Repository<Budget>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  /** System taxonomy merged with the user's custom categories and overrides. */
  async listForUser(userId: string) {
    const userRows = await this.categoryRepo.find({ where: { userId, isDeleted: false } });
    const byId = new Map<string, EffectiveCategory>();
    for (const c of SYSTEM_CATEGORIES) {
      byId.set(c.id, { ...c, isSystem: true, isHidden: false });
    }
    for (const row of userRows) {
      if (!row.clientId) continue;
      const system = byId.get(row.clientId);
      if (system && system.isSystem) {
        byId.set(row.clientId, {
          ...system,
          name: row.name,
          icon: row.icon,
          color: row.color,
          isHidden: row.isHidden,
          sortOrder: row.sortOrder,
        });
      } else {
        byId.set(row.clientId, {
          id: row.clientId,
          name: row.name,
          icon: row.icon,
          color: row.color,
          kind: row.kind,
          parentId: row.parentId,
          isSystem: false,
          isHidden: row.isHidden,
          sortOrder: row.sortOrder,
        });
      }
    }
    const categories = [...byId.values()]
      .filter((c) => !c.parentId || byId.has(c.parentId))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

    return {
      categories,
      defaults: { debit: DEFAULT_DEBIT_CATEGORY_ID, credit: DEFAULT_CREDIT_CATEGORY_ID },
      iconPalette: CATEGORY_ICON_PALETTE,
      colorPalette: CATEGORY_COLOR_PALETTE,
    };
  }

  /** Id -> name lookup for one user (for summaries, AI context, exports). */
  async namesForUser(userId: string): Promise<CategoryNames> {
    const rows = await this.categoryRepo.find({ where: { userId, isDeleted: false } });
    return new CategoryNames(rows);
  }

  async onApplicationBootstrap() {
    try {
      await this.backfill();
    } catch (err) {
      // Never block startup on the backfill; it is retried on the next boot.
      this.logger.error(`Category backfill failed: ${(err as Error).message}`);
    }
  }

  /**
   * One-time (idempotent) move from free-text category names to ids. The
   * Flutter app applies the same mapping to its local rows, so this does not
   * bump `updatedAt` for expenses and rules (no mass re-download).
   */
  async backfill() {
    const q = (sql: string, params: unknown[] = []) => this.dataSource.query(sql, params);

    // Expenses and merchant rules: legacy name -> ids + current display names.
    for (const [legacyName, [parentId, subId]] of Object.entries(LEGACY_CATEGORY_MAP)) {
      const parentName = SYSTEM_BY_ID.get(parentId)!.name;
      const subName = subId ? SYSTEM_BY_ID.get(subId)!.name : null;
      const creditsToIncome = parentId === DEFAULT_DEBIT_CATEGORY_ID;
      const incomeName = SYSTEM_BY_ID.get(DEFAULT_CREDIT_CATEGORY_ID)!.name;

      if (creditsToIncome) {
        await q(
          `UPDATE "expenses" SET "categoryId" = $1, "subcategoryId" = NULL, "category" = $2, "subcategory" = NULL
           WHERE "categoryId" IS NULL AND lower(trim("category")) = $3 AND "amount" < 0`,
          [DEFAULT_CREDIT_CATEGORY_ID, incomeName, legacyName],
        );
      }
      await q(
        `UPDATE "expenses" SET "categoryId" = $1, "subcategoryId" = $2, "category" = $3, "subcategory" = $4
         WHERE "categoryId" IS NULL AND lower(trim("category")) = $5`,
        [parentId, subId, parentName, subName, legacyName],
      );
      await q(
        `UPDATE "category_rules" SET "categoryId" = $1, "subcategoryId" = $2, "category" = $3
         WHERE "categoryId" IS NULL AND lower(trim("category")) = $4`,
        [parentId, subId, parentName, legacyName],
      );
    }

    // Anything else (names that are already new-style, or unknown) row by row.
    const leftovers: { id: string; category: string; amount: number }[] = await q(
      `SELECT "id", "category", "amount" FROM "expenses" WHERE "categoryId" IS NULL LIMIT 5000`,
    );
    for (const row of leftovers) {
      const sel = resolveLegacyCategory(row.category, row.amount < 0);
      await q(
        `UPDATE "expenses" SET "categoryId" = $1, "subcategoryId" = $2, "subcategory" = $3 WHERE "id" = $4`,
        [sel.categoryId, sel.subcategoryId, sel.subcategoryId ? SYSTEM_BY_ID.get(sel.subcategoryId)?.name ?? null : null, row.id],
      );
    }
    const ruleLeftovers: { id: string; category: string }[] = await q(
      `SELECT "id", "category" FROM "category_rules" WHERE "categoryId" IS NULL LIMIT 5000`,
    );
    for (const row of ruleLeftovers) {
      const sel = resolveLegacyCategory(row.category);
      await q(`UPDATE "category_rules" SET "categoryId" = $1, "subcategoryId" = $2 WHERE "id" = $3`, [
        sel.categoryId,
        sel.subcategoryId,
        row.id,
      ]);
    }

    await this.backfillBudgets();
  }

  /**
   * Budgets move from legacy names to parent ids. Budgets that land on the
   * same parent are merged (limits added). The surviving row is picked the
   * same way the app does (exact id first, then lowest clientId) so both
   * sides keep the same record.
   */
  private async backfillBudgets() {
    const parentIds = SYSTEM_CATEGORIES.filter((c) => !c.parentId).map((c) => c.id);
    const legacy = await this.budgetRepo.find({
      where: { category: Not(In(parentIds)), isDeleted: false },
    });
    if (legacy.length === 0) return;

    // Budgets on custom parent categories are already migrated.
    const customParents = await this.categoryRepo.find({
      where: { userId: In([...new Set(legacy.map((b) => b.userId))]), parentId: IsNull() },
    });
    const customKeys = new Set(customParents.map((c) => `${c.userId}|${c.clientId}`));
    const toMigrate = legacy.filter((b) => !customKeys.has(`${b.userId}|${b.category}`));
    if (toMigrate.length === 0) return;

    const groups = new Map<string, Budget[]>();
    for (const b of toMigrate) {
      const parentId = resolveLegacyCategory(b.category).categoryId;
      const key = `${b.userId}|${b.month}|${parentId}`;
      if (!groups.has(key)) {
        const existing = await this.budgetRepo.find({
          where: { userId: b.userId, month: b.month, category: parentId },
        });
        groups.set(key, existing.filter((e) => !e.isDeleted));
        // Free the unique (userId, month, category) slot held by a deleted row.
        for (const dead of existing.filter((e) => e.isDeleted)) {
          dead.category = `${parentId}#deleted#${dead.id}`;
          await this.budgetRepo.save(dead);
        }
      }
      groups.get(key)!.push(b);
    }

    for (const [key, rows] of groups) {
      const parentId = key.split('|')[2];
      if (rows.length === 1 && rows[0].category === parentId) continue;

      rows.sort((a, b) => {
        const aIsId = a.category === parentId ? 0 : 1;
        const bIsId = b.category === parentId ? 0 : 1;
        if (aIsId !== bIsId) return aIsId - bIsId;
        return (a.clientId ?? `~${a.id}`).localeCompare(b.clientId ?? `~${b.id}`);
      });
      const [keeper, ...extras] = rows;
      const total = rows.reduce((s, r) => s + r.limit, 0);

      for (const extra of extras) {
        extra.isDeleted = true;
        extra.version = (extra.version || 1) + 1;
        await this.budgetRepo.save(extra);
      }
      keeper.category = parentId;
      keeper.limit = total;
      keeper.version = (keeper.version || 1) + 1;
      await this.budgetRepo.save(keeper);
    }
    this.logger.log(`Migrated ${toMigrate.length} legacy budgets to category ids`);
  }
}
