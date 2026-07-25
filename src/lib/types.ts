/**
 * Shared contracts for Moneta. All lanes (domain, providers, API, UI) code against
 * these types. Changes here require hub approval — treat as frozen during M1–M4.
 */

// ---------- Core entities ----------

export type AccountType =
  | "checking"
  | "savings"
  | "credit"
  | "investment"
  | "loan"
  | "cash"
  | "other";

export interface Account {
  id: string;
  name: string;
  officialName: string | null;
  type: AccountType;
  /** ISO 4217 */
  currency: string;
  /** current balance in minor units (cents) */
  balance: number;
  /** available balance in minor units, if the provider reports one */
  available: number | null;
  institution: string | null;
  /** null for manual/imported accounts */
  connectionId: string | null;
  mask: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  accountId: string;
  /** provider-native id for dedup; null for manual entries */
  externalId: string | null;
  /** minor units; negative = outflow, positive = inflow */
  amount: number;
  currency: string;
  /** ISO date (YYYY-MM-DD) the transaction posted */
  date: string;
  name: string;
  merchant: string | null;
  categoryId: string | null;
  pending: boolean;
  notes: string | null;
  /** true when detected as part of a recurring series */
  recurringSeriesId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  /** null = top-level */
  parentId: string | null;
  /** lucide icon name */
  icon: string | null;
  /** whether spend here counts toward discretionary analysis */
  discretionary: boolean;
  system: boolean;
}

export interface Budget {
  id: string;
  categoryId: string;
  /** YYYY-MM the budget applies to; repeating budgets are materialized per month */
  month: string;
  /** limit in minor units */
  amount: number;
  createdAt: string;
}

export interface BudgetStatus extends Budget {
  spent: number;
  remaining: number;
  /** projected end-of-month spend based on run rate */
  projected: number;
  categoryName: string;
}

export interface RecurringSeries {
  id: string;
  name: string;
  merchant: string | null;
  /** average amount, minor units */
  amount: number;
  cadence: "weekly" | "biweekly" | "monthly" | "quarterly" | "yearly";
  lastDate: string;
  nextExpectedDate: string;
  accountId: string;
  active: boolean;
}

export interface NetWorthPoint {
  /** ISO date */
  date: string;
  assets: number;
  liabilities: number;
  net: number;
}

// ---------- Insights (ADR 0007) ----------

export type InsightKind =
  | "category_spike"
  | "new_subscription"
  | "unused_subscription"
  | "budget_breach_forecast"
  | "savings_rate"
  | "cash_runway"
  | "large_transaction"
  | "duplicate_charge";

export interface Insight {
  id: string;
  kind: InsightKind;
  severity: "info" | "warn" | "critical";
  title: string;
  body: string;
  /** suggested next step, imperative mood */
  action: string | null;
  /** related entity ids for deep-linking */
  refs: { accountId?: string; categoryId?: string; transactionId?: string; recurringSeriesId?: string };
  /** YYYY-MM period the insight was computed for */
  period: string;
  dismissed: boolean;
  createdAt: string;
}

// ---------- Bank providers (ADR 0003) ----------

export type ProviderKind = "plaid" | "simplefin" | "teller" | "manual";

export interface Connection {
  id: string;
  provider: ProviderKind;
  institution: string | null;
  status: "ok" | "error" | "reauth_required";
  lastSyncAt: string | null;
  createdAt: string;
}

export interface ProviderAccount {
  externalId: string;
  name: string;
  officialName: string | null;
  type: AccountType;
  currency: string;
  balance: number;
  available: number | null;
  institution: string | null;
  mask: string | null;
}

export interface ProviderTransaction {
  externalId: string;
  accountExternalId: string;
  amount: number;
  currency: string;
  date: string;
  name: string;
  merchant: string | null;
  pending: boolean;
}

export interface SyncResult {
  accounts: ProviderAccount[];
  added: ProviderTransaction[];
  modified: ProviderTransaction[];
  removedExternalIds: string[];
  /** opaque cursor persisted by the caller and passed to the next sync */
  nextCursor: string | null;
}

/**
 * Every bank adapter implements this. Credentials arrive already-decrypted as an
 * opaque JSON blob whose shape is adapter-specific (validated with zod inside).
 */
export interface BankProvider {
  readonly kind: ProviderKind;
  /** validate credentials / reachability without mutating anything */
  test(credentials: unknown): Promise<{ ok: boolean; message?: string }>;
  listAccounts(credentials: unknown): Promise<ProviderAccount[]>;
  sync(credentials: unknown, cursor: string | null): Promise<SyncResult>;
}

// ---------- API envelope ----------

export interface ApiError {
  error: { code: string; message: string };
}

export type ApiResult<T> = T | ApiError;

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// ---------- Auth ----------

export interface SessionUser {
  id: string;
  username: string;
}

// ---------- REST surface (implemented by Lane D, consumed by Lane C) ----------
// GET    /api/accounts                     -> Account[]
// GET    /api/transactions?accountId&categoryId&q&from&to&limit&offset -> Paginated<Transaction>
// PATCH  /api/transactions/:id             -> Transaction        (categoryId, notes)
// GET    /api/categories                   -> Category[]
// GET    /api/budgets?month=YYYY-MM        -> BudgetStatus[]
// PUT    /api/budgets                      -> Budget             ({categoryId, month, amount})
// GET    /api/networth?from&to             -> NetWorthPoint[]
// GET    /api/insights?period=YYYY-MM      -> Insight[]
// POST   /api/insights/:id/dismiss         -> { ok: true }
// GET    /api/recurring                    -> RecurringSeries[]
// GET    /api/connections                  -> Connection[]
// POST   /api/connections                  -> Connection         ({provider, credentials})
// POST   /api/connections/:id/sync         -> { added: number; modified: number }
// DELETE /api/connections/:id              -> { ok: true }
// POST   /api/import/csv                   -> { imported: number } (multipart)
// POST   /api/auth/setup | login | logout  -> { ok: true }
// GET    /api/auth/me                      -> SessionUser
