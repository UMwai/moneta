import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { id } from "@/db/id";
import { categories } from "@/db/schema";
import type { Category } from "@/lib/types";
import { toCategory } from "./mappers";

export function listCategories(db: Db): Category[] {
  return db
    .select()
    .from(categories)
    .orderBy(asc(categories.parentId), asc(categories.name))
    .all()
    .map(toCategory);
}

export function getCategory(db: Db, categoryId: string): Category | null {
  const row = db
    .select()
    .from(categories)
    .where(eq(categories.id, categoryId))
    .get();
  return row ? toCategory(row) : null;
}

export function createCategory(
  db: Db,
  input: {
    name: string;
    parentId?: string | null;
    icon?: string | null;
    discretionary?: boolean;
  },
): Category {
  const row = {
    id: id("cat"),
    name: input.name,
    parentId: input.parentId ?? null,
    icon: input.icon ?? null,
    discretionary: input.discretionary ?? false,
    system: false,
  };
  db.insert(categories).values(row).run();
  return toCategory(row);
}

export function updateCategory(
  db: Db,
  categoryId: string,
  patch: Partial<Pick<Category, "name" | "icon" | "discretionary" | "parentId">>,
): Category | null {
  db.update(categories).set(patch).where(eq(categories.id, categoryId)).run();
  return getCategory(db, categoryId);
}

export function deleteCategory(db: Db, categoryId: string): void {
  db.delete(categories)
    .where(eq(categories.id, categoryId))
    .run();
}

/** A category id plus every id beneath it, for "spend in the Food tree" queries. */
export function descendantIds(all: Category[], rootId: string): string[] {
  const byParent = new Map<string | null, Category[]>();
  for (const c of all) {
    const bucket = byParent.get(c.parentId) ?? [];
    bucket.push(c);
    byParent.set(c.parentId, bucket);
  }
  const out: string[] = [];
  const walk = (cid: string) => {
    out.push(cid);
    for (const child of byParent.get(cid) ?? []) walk(child.id);
  };
  walk(rootId);
  return out;
}

/** Membership test against a set of roots, e.g. "is this transfer-like?". */
export function isUnderAny(
  all: Category[],
  categoryId: string | null,
  roots: readonly string[],
): boolean {
  if (!categoryId) return false;
  const byId = new Map(all.map((c) => [c.id, c]));
  let cursor: string | null = categoryId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    if (roots.includes(cursor)) return true;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
}

export function isDiscretionary(
  all: Category[],
  categoryId: string | null,
): boolean {
  if (!categoryId) return false;
  return all.find((c) => c.id === categoryId)?.discretionary ?? false;
}
