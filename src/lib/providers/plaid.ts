/**
 * Plaid adapter (ADR 0003). The user brings their own client id + secret; nothing is
 * shared with Moneta's authors. Credentials arrive already decrypted from `crypto.ts`
 * as an opaque blob and are validated here with zod before any network call.
 *
 * The client is created per call from the supplied credentials and never cached, so
 * a settings change takes effect immediately. `createClient` is injectable, which is
 * what keeps the unit tests offline.
 */

import { z } from "zod";
import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
  type AccountBase,
  type AccountsGetRequest,
  type AccountsGetResponse,
  type ItemGetRequest,
  type ItemGetResponse,
  type ItemPublicTokenExchangeRequest,
  type ItemPublicTokenExchangeResponse,
  type LinkTokenCreateRequest,
  type LinkTokenCreateResponse,
  type Transaction as PlaidTransaction,
  type TransactionsSyncRequest,
  type TransactionsSyncResponse,
} from "plaid";

import type {
  AccountType,
  BankProvider,
  ProviderAccount,
  ProviderTransaction,
  SyncResult,
} from "@/lib/types";
import { CredentialsError, ProviderError, safeMessage } from "./errors";
import { normalizeCurrency, numberToMinor } from "./money";

// ---------- credentials ----------

export const plaidEnvSchema = z.enum(["sandbox", "development", "production"]);

export const plaidCredentialsSchema = z.object({
  clientId: z.string().trim().min(1, "Plaid client id is required"),
  secret: z.string().trim().min(1, "Plaid secret is required"),
  env: plaidEnvSchema.default("sandbox"),
  /** present once the Link flow has been completed for this connection */
  accessToken: z.string().trim().min(1).optional(),
});

export type PlaidEnv = z.infer<typeof plaidEnvSchema>;
export type PlaidCredentials = z.infer<typeof plaidCredentialsSchema>;

/**
 * plaid@45 dropped `development` from `PlaidEnvironments` (Plaid sunset that
 * environment), but existing self-hosters may still hold development keys, so the
 * host is kept here explicitly rather than rejecting the value.
 */
const BASE_PATHS: Record<PlaidEnv, string> = {
  sandbox: PlaidEnvironments.sandbox ?? "https://sandbox.plaid.com",
  development: PlaidEnvironments.development ?? "https://development.plaid.com",
  production: PlaidEnvironments.production ?? "https://production.plaid.com",
};

export function parsePlaidCredentials(credentials: unknown): PlaidCredentials {
  const parsed = plaidCredentialsSchema.safeParse(credentials);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new CredentialsError(
      "plaid",
      `Invalid Plaid credentials: ${issue ? `${issue.path.join(".") || "credentials"} — ${issue.message}` : "unrecognised shape"}`,
    );
  }
  return parsed.data;
}

// ---------- injectable client ----------

/** The slice of `PlaidApi` this adapter uses; `PlaidApi` satisfies it structurally. */
export interface PlaidClientLike {
  itemGet(req: ItemGetRequest): Promise<{ data: ItemGetResponse }>;
  accountsGet(req: AccountsGetRequest): Promise<{ data: AccountsGetResponse }>;
  transactionsSync(req: TransactionsSyncRequest): Promise<{ data: TransactionsSyncResponse }>;
  linkTokenCreate(req: LinkTokenCreateRequest): Promise<{ data: LinkTokenCreateResponse }>;
  itemPublicTokenExchange(
    req: ItemPublicTokenExchangeRequest,
  ): Promise<{ data: ItemPublicTokenExchangeResponse }>;
}

export function defaultPlaidClient(credentials: PlaidCredentials): PlaidClientLike {
  return new PlaidApi(
    new Configuration({
      basePath: BASE_PATHS[credentials.env],
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": credentials.clientId,
          "PLAID-SECRET": credentials.secret,
          "Plaid-Version": "2020-09-14",
        },
      },
    }),
  );
}

export interface PlaidProviderOptions {
  createClient?: (credentials: PlaidCredentials) => PlaidClientLike;
  /** shown in the Link UI */
  clientName?: string;
  countryCodes?: CountryCode[];
  language?: string;
  /** how far back the first sync reaches when Plaid has no cursor yet */
  maxSyncPages?: number;
}

export interface CreateLinkTokenOptions {
  clientUserId?: string;
  clientName?: string;
  products?: Products[];
  countryCodes?: CountryCode[];
  language?: string;
  redirectUri?: string;
  webhook?: string;
  /** set for update mode / re-auth of an existing item */
  accessToken?: string;
}

export interface LinkTokenResult {
  linkToken: string;
  expiration: string;
}

export interface ExchangePublicTokenResult {
  accessToken: string;
  itemId: string;
}

export interface PlaidProvider extends BankProvider {
  readonly kind: "plaid";
  createLinkToken(credentials: unknown, options?: CreateLinkTokenOptions): Promise<LinkTokenResult>;
  exchangePublicToken(credentials: unknown, publicToken: string): Promise<ExchangePublicTokenResult>;
}

// ---------- mapping ----------

const DEPOSITORY_SAVINGS = new Set([
  "savings",
  "cd",
  "money market",
  "hsa",
  "ebt",
  "cash isa",
  "isa",
  "tfsa",
  "rrsp",
]);
const DEPOSITORY_CASH = new Set(["prepaid", "cash management", "paypal", "non-custodial wallet"]);

/** Plaid `type`/`subtype` pair -> Moneta `AccountType`. */
export function mapPlaidAccountType(
  type: string | null | undefined,
  subtype?: string | null,
): AccountType {
  const t = (type ?? "").toLowerCase();
  const s = (subtype ?? "").toLowerCase();

  switch (t) {
    case "depository":
      if (DEPOSITORY_SAVINGS.has(s)) return "savings";
      if (DEPOSITORY_CASH.has(s)) return "cash";
      return "checking";
    case "credit":
      return "credit";
    case "loan":
      return "loan";
    case "investment":
    case "brokerage":
      return "investment";
    default:
      return "other";
  }
}

/**
 * Balances are passed through with Plaid's sign convention: a credit card with $500
 * owed reports `balance: 50000`, positive. The account `type` carries the liability
 * semantics, so the domain layer decides the sign when computing net worth.
 */
export function mapPlaidAccount(account: AccountBase, institution: string | null = null): ProviderAccount {
  const balances = account.balances;
  return {
    externalId: account.account_id,
    name: account.name,
    officialName: account.official_name ?? null,
    type: mapPlaidAccountType(account.type, account.subtype),
    currency: normalizeCurrency(balances.iso_currency_code ?? balances.unofficial_currency_code),
    balance: numberToMinor(balances.current ?? 0),
    available: balances.available === null || balances.available === undefined
      ? null
      : numberToMinor(balances.available),
    institution,
    mask: account.mask ?? null,
  };
}

/**
 * Plaid signs money *leaving* the account as positive; Moneta stores outflow as
 * negative (see `Transaction.amount` in types.ts), hence the inversion.
 */
export function mapPlaidTransaction(txn: PlaidTransaction): ProviderTransaction {
  return {
    externalId: txn.transaction_id,
    accountExternalId: txn.account_id,
    amount: -numberToMinor(txn.amount),
    currency: normalizeCurrency(txn.iso_currency_code ?? txn.unofficial_currency_code),
    date: normalizeDate(txn.date),
    name: txn.name || txn.merchant_name || "Transaction",
    merchant: txn.merchant_name ?? null,
    pending: Boolean(txn.pending),
  };
}

function normalizeDate(value: string): string {
  return value.length > 10 ? value.slice(0, 10) : value;
}

// ---------- provider ----------

const DEFAULT_MAX_SYNC_PAGES = 100;

export function createPlaidProvider(options: PlaidProviderOptions = {}): PlaidProvider {
  const createClient = options.createClient ?? defaultPlaidClient;
  const clientName = options.clientName ?? "Moneta";
  const countryCodes = options.countryCodes ?? [CountryCode.Us];
  const language = options.language ?? "en";
  const maxSyncPages = options.maxSyncPages ?? DEFAULT_MAX_SYNC_PAGES;

  function requireAccessToken(credentials: PlaidCredentials): string {
    if (!credentials.accessToken) {
      throw new ProviderError(
        "plaid",
        "This Plaid connection has not completed the Link flow yet — no access token stored.",
        "reauth_required",
      );
    }
    return credentials.accessToken;
  }

  return {
    kind: "plaid",

    async test(credentials) {
      let creds: PlaidCredentials;
      try {
        creds = parsePlaidCredentials(credentials);
      } catch (err) {
        return { ok: false, message: safeMessage(err, "Invalid Plaid credentials") };
      }

      try {
        const client = createClient(creds);
        if (creds.accessToken) {
          const { data } = await client.itemGet({ access_token: creds.accessToken });
          const institutionId = data.item?.institution_id ?? null;
          return {
            ok: true,
            message: institutionId
              ? `Connected to Plaid (${creds.env}), institution ${institutionId}.`
              : `Connected to Plaid (${creds.env}).`,
          };
        }
        // No item yet: creating a link token proves the key pair works and mutates nothing.
        await client.linkTokenCreate(
          buildLinkTokenRequest(clientName, language, countryCodes, {}),
        );
        return { ok: true, message: `Plaid credentials valid (${creds.env}); ready to link an account.` };
      } catch (err) {
        return { ok: false, message: describePlaidError(err) };
      }
    },

    async listAccounts(credentials) {
      const creds = parsePlaidCredentials(credentials);
      const accessToken = requireAccessToken(creds);
      try {
        const { data } = await createClient(creds).accountsGet({ access_token: accessToken });
        const institution = null;
        return data.accounts.map((account) => mapPlaidAccount(account, institution));
      } catch (err) {
        throw asProviderError(err);
      }
    },

    async sync(credentials, cursor) {
      const creds = parsePlaidCredentials(credentials);
      const accessToken = requireAccessToken(creds);
      const client = createClient(creds);

      const added: ProviderTransaction[] = [];
      const modified: ProviderTransaction[] = [];
      const removedExternalIds: string[] = [];
      let accounts: ProviderAccount[] = [];
      let nextCursor = cursor ?? undefined;

      try {
        for (let page = 0; page < maxSyncPages; page += 1) {
          const request: TransactionsSyncRequest = { access_token: accessToken };
          if (nextCursor) request.cursor = nextCursor;
          const { data } = await client.transactionsSync(request);

          for (const txn of data.added ?? []) added.push(mapPlaidTransaction(txn));
          for (const txn of data.modified ?? []) modified.push(mapPlaidTransaction(txn));
          for (const removed of data.removed ?? []) removedExternalIds.push(removed.transaction_id);
          if (data.accounts?.length) {
            accounts = data.accounts.map((account) => mapPlaidAccount(account));
          }

          nextCursor = data.next_cursor;
          if (!data.has_more) break;
        }
      } catch (err) {
        throw asProviderError(err);
      }

      return {
        accounts,
        added,
        modified,
        removedExternalIds,
        nextCursor: nextCursor ?? null,
      } satisfies SyncResult;
    },

    async createLinkToken(credentials, linkOptions = {}) {
      const creds = parsePlaidCredentials(credentials);
      try {
        const { data } = await createClient(creds).linkTokenCreate(
          buildLinkTokenRequest(
            linkOptions.clientName ?? clientName,
            linkOptions.language ?? language,
            linkOptions.countryCodes ?? countryCodes,
            { ...linkOptions, accessToken: linkOptions.accessToken ?? creds.accessToken },
          ),
        );
        return { linkToken: data.link_token, expiration: data.expiration };
      } catch (err) {
        throw asProviderError(err);
      }
    },

    async exchangePublicToken(credentials, publicToken) {
      const creds = parsePlaidCredentials(credentials);
      const token = z.string().trim().min(1).safeParse(publicToken);
      if (!token.success) {
        throw new CredentialsError("plaid", "A public token is required to complete linking.");
      }
      try {
        const { data } = await createClient(creds).itemPublicTokenExchange({
          public_token: token.data,
        });
        return { accessToken: data.access_token, itemId: data.item_id };
      } catch (err) {
        throw asProviderError(err);
      }
    },
  };
}

function buildLinkTokenRequest(
  clientName: string,
  language: string,
  countryCodes: CountryCode[],
  options: CreateLinkTokenOptions,
): LinkTokenCreateRequest {
  const request: LinkTokenCreateRequest = {
    client_name: clientName,
    language,
    country_codes: countryCodes,
    user: { client_user_id: options.clientUserId ?? "moneta-local-user" },
  };
  // Update mode takes an access token instead of a product list.
  if (options.accessToken) {
    request.access_token = options.accessToken;
  } else {
    request.products = options.products ?? [Products.Transactions];
  }
  if (options.redirectUri) request.redirect_uri = options.redirectUri;
  if (options.webhook) request.webhook = options.webhook;
  return request;
}

// ---------- error handling ----------

interface PlaidErrorBody {
  error_code?: string;
  error_message?: string;
  display_message?: string | null;
}

function plaidErrorBody(err: unknown): PlaidErrorBody | null {
  if (typeof err !== "object" || err === null) return null;
  const response = (err as { response?: unknown }).response;
  if (typeof response !== "object" || response === null) return null;
  const data = (response as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  return data as PlaidErrorBody;
}

/** A user-facing message built only from Plaid's error fields — never the request. */
export function describePlaidError(err: unknown): string {
  const body = plaidErrorBody(err);
  if (body) {
    const detail = body.display_message || body.error_message || "Plaid rejected the request";
    return body.error_code ? `${detail} (${body.error_code})` : detail;
  }
  return safeMessage(err, "Could not reach Plaid");
}

function asProviderError(err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  const body = plaidErrorBody(err);
  return new ProviderError(
    "plaid",
    describePlaidError(err),
    body?.error_code ? body.error_code.toLowerCase() : "provider_error",
  );
}

// ---------- default instance + standalone Link helpers ----------

export const plaidProvider: PlaidProvider = createPlaidProvider();

export function createLinkToken(
  credentials: unknown,
  options?: CreateLinkTokenOptions,
): Promise<LinkTokenResult> {
  return plaidProvider.createLinkToken(credentials, options);
}

export function exchangePublicToken(
  credentials: unknown,
  publicToken: string,
): Promise<ExchangePublicTokenResult> {
  return plaidProvider.exchangePublicToken(credentials, publicToken);
}
