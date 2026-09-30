import {
  DEFAULT_CREDIT_CATEGORY_ID,
  DEFAULT_DEBIT_CATEGORY_ID,
  LEGACY_CATEGORY_MAP,
  SYSTEM_CATEGORIES,
  SystemCategory,
} from './taxonomy.generated';

export interface CategorySelection {
  categoryId: string;
  subcategoryId: string | null;
}

export const SYSTEM_BY_ID: ReadonlyMap<string, SystemCategory> = new Map(
  SYSTEM_CATEGORIES.map((c) => [c.id, c]),
);

/**
 * Maps a free-text category name written by an older client (or the web app)
 * to ids. Mirrors CategoryResolver.fromLegacyName in the Flutter app.
 */
export function resolveLegacyCategory(name: string | null | undefined, isCredit = false): CategorySelection {
  const key = (name ?? '').trim().toLowerCase();
  const mapped = LEGACY_CATEGORY_MAP[key];
  if (mapped) {
    const [parent, sub] = mapped;
    if (isCredit && parent === DEFAULT_DEBIT_CATEGORY_ID) {
      return { categoryId: DEFAULT_CREDIT_CATEGORY_ID, subcategoryId: null };
    }
    return { categoryId: parent, subcategoryId: sub };
  }

  for (const c of SYSTEM_CATEGORIES) {
    if (c.id === key || c.name.toLowerCase() === key) {
      return c.parentId ? { categoryId: c.parentId, subcategoryId: c.id } : { categoryId: c.id, subcategoryId: null };
    }
  }

  return { categoryId: isCredit ? DEFAULT_CREDIT_CATEGORY_ID : DEFAULT_DEBIT_CATEGORY_ID, subcategoryId: null };
}

/** Minimal shape of a user category row used for name resolution. */
export interface UserCategoryLike {
  clientId: string | null;
  name: string;
  parentId: string | null;
  isDeleted?: boolean;
}

/**
 * Resolves category ids to display names for one user: system taxonomy plus
 * their custom categories and renames.
 */
export class CategoryNames {
  private readonly names = new Map<string, string>();

  constructor(userCategories: UserCategoryLike[] = []) {
    for (const c of SYSTEM_CATEGORIES) this.names.set(c.id, c.name);
    for (const c of userCategories) {
      if (c.clientId && !c.isDeleted) this.names.set(c.clientId, c.name);
    }
  }

  name(id: string | null | undefined): string | null {
    return id ? this.names.get(id) ?? null : null;
  }

  /** "Food & Drinks › Restaurants" */
  label(categoryId: string | null | undefined, subcategoryId?: string | null, fallback = 'Miscellaneous'): string {
    const parent = this.name(categoryId) ?? fallback;
    const sub = this.name(subcategoryId);
    return sub ? `${parent} › ${sub}` : parent;
  }
}
