import { asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { id } from "@/db/id";
import { budgets } from "@/db/schema";
import {
  daysInPeriod,
  elapsedDaysInPeriod,
  nowISO,
  periodRange,
  todayISO,
} from "@/lib/domain/dates";
import type { Budget, BudgetStatus, Category } from "@/lib/types";
import { descendantIds, listCategories } from "./categories";
import { toBudget } from "./mappers";
import { sumByCategory } from "./transactions";

export function upsertBudget(
  db: Db,
  input: { categoryId: string; month: string; amount: number },
): Budget {
  const row = {
    id: id("bdg"),
    categoryId: input.categoryId,
    month: input.month,
    amount: input.amount,
    createdAt: nowISO(),
  };
  const [saved] = db
    .insert(budgets)
    .values(row)
    .onConflictDoUpdate({
      target: [budgets.categoryId, budgets.month],
      set: { amount: input.amount },
    })
    .returning()
    .all();
  return toBudget(saved ?? row);
}

export function listBudgets(db: Db, month: string): Budget[] {
  return db
    .select()
    .from(budgets)
    .where(eq(budgets.month, month))
    .orderBy(asc(budgets.categoryId))
    .all()
    .map(toBudget);
}

export function getBudget(db: Db, budgetId: string): Budget | null {
  const row = db.select().from(budgets).where(eq(budgets.id, budgetId)).get();
  return row ? toBudget(row) : null;
}

export function deleteBudget(db: Db, budgetId: string): void {
  db.delete(budgets).where(eq(budgets.id, budgetId)).run();
}

/**
 * Envelope status for one budget.
 *
 * `spent` is net outflow (refunds reduce it, floored at 0) across the category
 * and everything under it. `projected` is a linear run-rate: spend so far scaled
 * by the fraction of the month elapsed, so a month that has already ended
 * projects to exactly what was spent.
 */
export function computeBudgetStatus(
  budget: Budget,
  spent: number,
  categoryName: string,
  today: string = todayISO(),
): BudgetStatus {
  const total = daysInPeriod(budget.month);
  const elapsed = elapsedDaysInPeriod(budget.month, today);
  const projected = Math.round((spent / elapsed) * total);
  return {
    ...budget,
    categoryName,
    spent,
    remaining: budget.amount - spent,
    projected,
  };
}

/** Net outflow in a category subtree for a month, floored at 0. */
export function spentForCategory(
  totals: Map<string, number>,
  categories: Category[],
  categoryId: string,
): number {
  const ids = descendantIds(categories, categoryId);
  let signed = 0;
  for (const cid of ids) signed += totals.get(cid) ?? 0;
  return Math.max(-signed, 0);
}

export function listBudgetStatus(
  db: Db,
  month: string,
  today: string = todayISO(),
): BudgetStatus[] {
  const all = listBudgets(db, month);
  if (all.length === 0) return [];
  const categories = listCategories(db);
  const nameById = new Map(categories.map((c) => [c.id, c.name]));
  const totals = sumByCategory(db, periodRange(month));
  return all.map((b) =>
    computeBudgetStatus(
      b,
      spentForCategory(totals, categories, b.categoryId),
      nameById.get(b.categoryId) ?? "Unknown",
      today,
    ),
  );
}
