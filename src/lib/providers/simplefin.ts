/**
 * SimpleFIN Bridge adapter (ADR 0003) — the individual-friendly option: a few dollars
 * a year, no developer application, plain HTTPS with basic auth.
 *
 * Flow:
 *   1. The user pastes a *setup token* (base64 of a one-shot claim URL).
 *   2. `POST` to that URL exactly once returns an *access URL* of the form
 *      `https://user:pass@bridge.simplefin.org/simplefin`.
 *   3. Every later call is `GET <accessUrl>/accounts?start-date=…` with the userinfo
 *      moved into an `Authorization: Basic` header.
 *
 * The access URL embeds credentials, so it is stored sealed (ADR 0005) and never
 * logged — error messages here are built from status codes, never from the URL.
 */

import { z } from "zod";

import type {
  AccountType,
  BankProvider,
  ProviderAccount,
  ProviderTransaction,
  SyncResult,
} from "@/lib/types";
import { CredentialsError, ProviderError, safeMessage } from "./errors";
import { decimalStringToMinor, normalizeCurrency } from "./money";

// ---------- credentials ----------

export const simpleFinCredentialsSchema = z
  .object({
    setupToken: z.string().trim().min(1).optional(),
    accessUrl: z.string().trim().url("SimpleFIN access URL must be a URL").optional(),
  })
  .refine((value) => Boolean(value.setupToken || value.accessUrl), {
    message: "Provide either a SimpleFIN setup token or an access URL",
  });

export type SimpleFinCredentials = z.infer<typeof simpleFinCredentialsSchema>;

export function parseSimpleFinCredentials(credentials: unknown): SimpleFinCredentials {
  const parsed = simpleFinCredentialsSchema.safeParse(credentials);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new CredentialsError(
      "simplefin",
      `Invalid SimpleFIN credentials: ${issue?.message ?? "unrecognised shape"}`,
    );
  }
  return parsed.data;
}

// ---------- wire format ----------

const simpleFinOrgSchema = z
  .object({
    domain: z.string().optional(),
    name: z.string().optional(),
    "sfin-url": z.string().optional(),
    url: z.string().optional(),
    id: z.string().optional(),
  })
  .partial();

const simpleFinTransactionSchema = z.object({
  id: z.string(),
  posted: z.number(),
  amount: z.union([z.string(), z.number()]),
  description: z.string().optional(),
  payee: z.string().optional(),
  memo: z.string().optional(),
  pending: z.boolean().optional(),
  transacted_at: z.number().optional(),
});

const simpleFinAccountSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  currency: z.string().optional(),
  balance: z.union([z.string(), z.number()]).optional(),
  "available-balance": z.union([z.string(), z.number()]).optional(),
  "balance-date": z.number().optional(),
  org: simpleFinOrgSchema.optional(),
  transactions: z.array(simpleFinTransactionSchema).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

const simpleFinResponseSchema = z.object({
  errors: z.array(z.string()).optional(),
  accounts: z.array(simpleFinAccountSchema).optional(),
});

export type SimpleFinAccountPayload = z.infer<typeof simpleFinAccountSchema>;
export type SimpleFinTransactionPayload = z.infer<typeof simpleFinTransactionSchema>;

// ---------- cursor ----------

/**
 * SimpleFIN has no delta/cursor API, only `start-date`. We therefore mint our own
 * opaque cursor `sf1:<unix seconds>` and re-request a small overlap window each time
 * so late-posting transactions are not missed; the caller dedupes on `externalId`.
 */
const CURSOR_PREFIX = "sf1:";
const OVERLAP_SECONDS = 3 * 24 * 60 * 60;
const DEFAULT_LOOKBACK_SECONDS = 90 * 24 * 60 * 60;

export function encodeSimpleFinCursor(unixSeconds: number): string {
  return `${CURSOR_PREFIX}${Math.max(0, Math.floor(unixSeconds))}`;
}

export function decodeSimpleFinCursor(cursor: string | null): number | null {
  if (!cursor || !cursor.startsWith(CURSOR_PREFIX)) return null;
  const seconds = Number.parseInt(cursor.slice(CURSOR_PREFIX.length), 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

// ---------- mapping ----------

const TYPE_HINTS: Array<[RegExp, AccountType]> = [
  [/\b(credit|card|visa|mastercard|amex)\b/i, "credit"],
  [/\b(save|savings|money ?market|cd\b|certificate)\b/i, "savings"],
  [/\b(check|checking|chequing|current)\b/i, "checking"],
  [/\b(loan|mortgage|auto|student|heloc|line of credit)\b/i, "loan"],
  [/\b(invest|brokerage|401k|ira|roth|retire)\b/i, "investment"],
  [/\b(cash|wallet|prepaid)\b/i, "cash"],
];

/**
 * SimpleFIN carries no account-type field, so the name is the only signal available.
 * Falls back to `other` rather than guessing `checking`.
 */
export function inferSimpleFinAccountType(name: string): AccountType {
  for (const [pattern, type] of TYPE_HINTS) {
    if (pattern.test(name)) return type;
  }
  return "other";
}

function toMinor(value: string | number | undefined, fallback: number | null): number | null {
  if (value === undefined || value === null) return fallback;
  const asString = typeof value === "number" ? value.toFixed(4) : value;
  const minor = decimalStringToMinor(asString);
  return minor ?? fallback;
}

export function mapSimpleFinAccount(account: SimpleFinAccountPayload): ProviderAccount {
  const name = account.name?.trim() || account.id;
  return {
    externalId: account.id,
    name,
    officialName: null,
    type: inferSimpleFinAccountType(`${name} ${account.org?.name ?? ""}`),
    currency: normalizeCurrency(account.currency),
    balance: toMinor(account.balance, 0) ?? 0,
    available: toMinor(account["available-balance"], null),
    institution: account.org?.name ?? account.org?.domain ?? null,
    mask: null,
  };
}

/** SimpleFIN already signs outflow negative, matching Moneta — no inversion needed. */
export function mapSimpleFinTransaction(
  txn: SimpleFinTransactionPayload,
  account: SimpleFinAccountPayload,
): ProviderTransaction {
  const description = txn.description?.trim() || txn.payee?.trim() || txn.memo?.trim() || "Transaction";
  return {
    externalId: txn.id,
    accountExternalId: account.id,
    amount: toMinor(txn.amount, 0) ?? 0,
    currency: normalizeCurrency(account.currency),
    date: unixToIsoDate(txn.posted),
    name: description,
    merchant: txn.payee?.trim() || null,
    pending: Boolean(txn.pending),
  };
}

export function unixToIsoDate(seconds: number): string {
  const date = new Date(Math.floor(seconds) * 1000);
  return Number.isNaN(date.getTime()) ? "1970-01-01" : date.toISOString().slice(0, 10);
}

// ---------- HTTP ----------

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SimpleFinProviderOptions {
  fetch?: FetchLike;
  /** how far back a first-ever sync reaches, in days */
  initialLookbackDays?: number;
  /** injected for deterministic cursor assertions in tests */
  now?: () => Date;
}

export interface SimpleFinProvider extends BankProvider {
  readonly kind: "simplefin";
  /** exchange a one-shot setup token for a durable access URL */
  claimSetupToken(setupToken: string): Promise<string>;
  /** resolve credentials to an access URL, claiming the setup token if needed */
  resolveAccessUrl(credentials: unknown): Promise<string>;
}

/** Split `https://user:pass@host/path` into a credential-free URL plus a Basic header. */
export function splitAccessUrl(accessUrl: string): { baseUrl: string; authorization: string | null } {
  let url: URL;
  try {
    url = new URL(accessUrl);
  } catch {
    throw new CredentialsError("simplefin", "SimpleFIN access URL is not a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new CredentialsError("simplefin", "SimpleFIN access URL must be http(s).");
  }
  const { username, password } = url;
  url.username = "";
  url.password = "";
  const baseUrl = url.toString().replace(/\/+$/, "");
  const authorization = username
    ? `Basic ${Buffer.from(`${decodeURIComponent(username)}:${decodeURIComponent(password)}`, "utf8").toString("base64")}`
    : null;
  return { baseUrl, authorization };
}

export function decodeSetupToken(setupToken: string): string {
  const compact = setupToken.trim().replace(/\s+/g, "");
  if (!compact) throw new CredentialsError("simplefin", "SimpleFIN setup token is empty.");
  const decoded = Buffer.from(compact, "base64").toString("utf8").trim();
  if (!/^https?:\/\//i.test(decoded)) {
    throw new CredentialsError(
      "simplefin",
      "SimpleFIN setup token did not decode to a claim URL — copy it again from your bridge.",
    );
  }
  return decoded;
}

const DAY_SECONDS = 24 * 60 * 60;

export function createSimpleFinProvider(options: SimpleFinProviderOptions = {}): SimpleFinProvider {
  const fetchImpl: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
  const now = options.now ?? (() => new Date());
  const initialLookbackSeconds = options.initialLookbackDays
    ? options.initialLookbackDays * DAY_SECONDS
    : DEFAULT_LOOKBACK_SECONDS;

  async function claimSetupToken(setupToken: string): Promise<string> {
    const claimUrl = decodeSetupToken(setupToken);
    let response: Response;
    try {
      response = await fetchImpl(claimUrl, {
        method: "POST",
        headers: { "Content-Length": "0" },
      });
    } catch (err) {
      throw new ProviderError("simplefin", `Could not reach the SimpleFIN bridge: ${safeMessage(err, "network error")}`, "network_error");
    }
    if (!response.ok) {
      throw new ProviderError(
        "simplefin",
        response.status === 403
          ? "This SimpleFIN setup token has already been claimed. Generate a new one."
          : `SimpleFIN bridge rejected the claim (HTTP ${response.status}).`,
        "claim_failed",
      );
    }
    const accessUrl = (await response.text()).trim();
    if (!/^https?:\/\//i.test(accessUrl)) {
      throw new ProviderError("simplefin", "SimpleFIN bridge did not return an access URL.", "claim_failed");
    }
    return accessUrl;
  }

  async function resolveAccessUrl(credentials: unknown): Promise<string> {
    const creds = parseSimpleFinCredentials(credentials);
    if (creds.accessUrl) return creds.accessUrl;
    return claimSetupToken(creds.setupToken as string);
  }

  async function getAccounts(
    accessUrl: string,
    params: { startDate?: number; balancesOnly?: boolean },
  ): Promise<z.infer<typeof simpleFinResponseSchema>> {
    const { baseUrl, authorization } = splitAccessUrl(accessUrl);
    const url = new URL(`${baseUrl}/accounts`);
    if (params.startDate !== undefined) url.searchParams.set("start-date", String(params.startDate));
    if (params.balancesOnly) url.searchParams.set("balances-only", "1");

    const headers: Record<string, string> = { Accept: "application/json" };
    if (authorization) headers.Authorization = authorization;

    let response: Response;
    try {
      response = await fetchImpl(url.toString(), { method: "GET", headers });
    } catch (err) {
      throw new ProviderError("simplefin", `Could not reach the SimpleFIN bridge: ${safeMessage(err, "network error")}`, "network_error");
    }
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError(
        "simplefin",
        "SimpleFIN rejected the stored access URL. Re-claim a setup token in Settings.",
        "reauth_required",
      );
    }
    if (!response.ok) {
      throw new ProviderError("simplefin", `SimpleFIN returned HTTP ${response.status}.`, "provider_error");
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ProviderError("simplefin", "SimpleFIN returned a response that was not JSON.", "bad_response");
    }
    const parsed = simpleFinResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ProviderError("simplefin", "SimpleFIN returned an unexpected payload shape.", "bad_response");
    }
    return parsed.data;
  }

  return {
    kind: "simplefin",
    claimSetupToken,
    resolveAccessUrl,

    async test(credentials) {
      try {
        const accessUrl = await resolveAccessUrl(credentials);
        const data = await getAccounts(accessUrl, { balancesOnly: true });
        const count = data.accounts?.length ?? 0;
        const errors = data.errors ?? [];
        if (count === 0 && errors.length > 0) {
          return { ok: false, message: `SimpleFIN reported: ${errors.join("; ")}` };
        }
        return {
          ok: true,
          message: errors.length
            ? `${count} account(s) reachable; SimpleFIN warnings: ${errors.join("; ")}`
            : `${count} account(s) reachable.`,
        };
      } catch (err) {
        return { ok: false, message: safeMessage(err, "SimpleFIN connection failed") };
      }
    },

    async listAccounts(credentials) {
      const accessUrl = await resolveAccessUrl(credentials);
      const data = await getAccounts(accessUrl, { balancesOnly: true });
      return (data.accounts ?? []).map(mapSimpleFinAccount);
    },

    async sync(credentials, cursor) {
      const accessUrl = await resolveAccessUrl(credentials);
      const nowSeconds = Math.floor(now().getTime() / 1000);
      const since = decodeSimpleFinCursor(cursor);
      const startDate = since ?? nowSeconds - initialLookbackSeconds;

      const data = await getAccounts(accessUrl, { startDate });

      const accounts: ProviderAccount[] = [];
      const added: ProviderTransaction[] = [];
      for (const account of data.accounts ?? []) {
        accounts.push(mapSimpleFinAccount(account));
        for (const txn of account.transactions ?? []) {
          added.push(mapSimpleFinTransaction(txn, account));
        }
      }

      return {
        accounts,
        added,
        // SimpleFIN exposes no edit/delete feed; upserting by externalId is the whole story.
        modified: [],
        removedExternalIds: [],
        nextCursor: encodeSimpleFinCursor(Math.max(0, nowSeconds - OVERLAP_SECONDS)),
      } satisfies SyncResult;
    },
  };
}

export const simpleFinProvider: SimpleFinProvider = createSimpleFinProvider();
