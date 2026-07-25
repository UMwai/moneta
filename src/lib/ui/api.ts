import type {
  Account,
  Budget,
  BudgetStatus,
  Category,
  Connection,
  Insight,
  NetWorthPoint,
  Paginated,
  ProviderKind,
  RecurringSeries,
  SessionUser,
  Transaction,
} from "@/lib/types";

export class ApiRequestError extends Error {
  status: number;
  code: string;

  constructor(message: string, status: number, code = "request_failed") {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
  }
}

type QueryValue = string | number | undefined | null;

function withQuery<T extends object>(path: string, query?: T) {
  if (!query) return path;

  const search = new URLSearchParams();
  (Object.entries(query) as Array<[string, QueryValue]>).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  });

  const suffix = search.toString();
  return suffix ? `${path}?${suffix}` : path;
}

async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const isForm = init.body instanceof FormData;
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(isForm ? {} : { "Content-Type": "application/json" }),
      ...init.headers,
    },
  });

  if (response.status === 401) {
    if (
      typeof window !== "undefined" &&
      !["/login", "/setup"].includes(window.location.pathname)
    ) {
      const next = `${window.location.pathname}${window.location.search}`;
      window.location.assign(`/login?next=${encodeURIComponent(next)}`);
    }
    throw new ApiRequestError("Your session has expired. Please sign in.", 401, "unauthorized");
  }

  const text = await response.text();
  let payload: unknown = undefined;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = undefined;
    }
  }

  if (!response.ok) {
    const error =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      payload.error &&
      typeof payload.error === "object"
        ? payload.error
        : null;
    const message =
      error && "message" in error && typeof error.message === "string"
        ? error.message
        : `Request failed (${response.status})`;
    const code =
      error && "code" in error && typeof error.code === "string"
        ? error.code
        : "request_failed";

    throw new ApiRequestError(message, response.status, code);
  }

  return payload as T;
}

export interface TransactionQuery {
  accountId?: string;
  categoryId?: string;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export const api = {
  accounts: () => apiFetch<Account[]>("/api/accounts"),
  transactions: (query: TransactionQuery = {}) =>
    apiFetch<Paginated<Transaction>>(withQuery("/api/transactions", query)),
  updateTransaction: (
    id: string,
    patch: { categoryId?: string | null; notes?: string | null },
  ) =>
    apiFetch<Transaction>(`/api/transactions/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  categories: () => apiFetch<Category[]>("/api/categories"),
  budgets: (month: string) =>
    apiFetch<BudgetStatus[]>(withQuery("/api/budgets", { month })),
  putBudget: (input: { categoryId: string; month: string; amount: number }) =>
    apiFetch<Budget>("/api/budgets", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  netWorth: (query: { from?: string; to?: string } = {}) =>
    apiFetch<NetWorthPoint[]>(withQuery("/api/networth", query)),
  insights: (period?: string) =>
    apiFetch<Insight[]>(withQuery("/api/insights", { period })),
  dismissInsight: (id: string) =>
    apiFetch<{ ok: true }>(`/api/insights/${encodeURIComponent(id)}/dismiss`, {
      method: "POST",
      body: JSON.stringify({}),
    }),
  recurring: () => apiFetch<RecurringSeries[]>("/api/recurring"),
  connections: () => apiFetch<Connection[]>("/api/connections"),
  createConnection: (input: {
    provider: Exclude<ProviderKind, "manual">;
    credentials: Record<string, string>;
  }) =>
    apiFetch<Connection>("/api/connections", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  syncConnection: (id: string) =>
    apiFetch<{ added: number; modified: number }>(
      `/api/connections/${encodeURIComponent(id)}/sync`,
      { method: "POST", body: JSON.stringify({}) },
    ),
  deleteConnection: (id: string) =>
    apiFetch<{ ok: true }>(`/api/connections/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
  importCsv: (file: File, accountId: string) => {
    const body = new FormData();
    body.append("file", file);
    body.append("accountId", accountId);
    return apiFetch<{ imported: number }>("/api/import/csv", {
      method: "POST",
      body,
    });
  },
  login: (input: { username: string; password: string }) =>
    apiFetch<{ ok: true }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  setup: (input: { username: string; password: string }) =>
    apiFetch<{ ok: true }>("/api/auth/setup", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  logout: () =>
    apiFetch<{ ok: true }>("/api/auth/logout", {
      method: "POST",
      body: JSON.stringify({}),
    }),
  me: () => apiFetch<SessionUser>("/api/auth/me"),
};

export function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
