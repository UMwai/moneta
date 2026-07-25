import type {
  Account,
  Budget,
  Category,
  Insight,
  RecurringSeries,
  Transaction,
} from "@/lib/types";

/**
 * A rule's output: everything about an insight except the bits only storage owns
 * (row id, dismissed flag, timestamps). `dedupeKey` is the rule's stable identity
 * for the period — re-running the engine updates the same row rather than piling
 * up duplicates, and preserves a dismissal the user already made.
 */
export interface InsightDraft {
  kind: Insight["kind"];
  severity: Insight["severity"];
  title: string;
  body: string;
  /** imperative next step — never null; the mission is to help, not to report */
  action: string;
  refs: Insight["refs"];
  period: string;
  dedupeKey: string;
}

/** A recurring series plus the detection metadata the rules need. */
export interface SeriesContext extends RecurringSeries {
  firstDate: string;
  occurrences: number;
  categoryId: string | null;
  normalizedKey: string;
}

/**
 * Everything a rule may read. Rules are pure: same context in, same drafts out.
 * `transactions` is a trailing window (the engine loads ~13 months) sorted
 * ascending by date, covering every account including archived ones.
 */
export interface InsightContext {
  /** YYYY-MM being analysed */
  period: string;
  /** ISO date treated as "now" */
  today: string;
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  budgets: Budget[];
  recurring: SeriesContext[];
}

export type InsightRule = (ctx: InsightContext) => InsightDraft[];
