import { describe, expect, it } from "vitest";
import {
  AccountSubtype,
  AccountType as PlaidAccountType,
  type AccountBase,
  type AccountsGetResponse,
  type ItemGetResponse,
  type ItemPublicTokenExchangeResponse,
  type LinkTokenCreateRequest,
  type LinkTokenCreateResponse,
  type Transaction as PlaidTransaction,
  type TransactionsSyncRequest,
  type TransactionsSyncResponse,
} from "plaid";

import { ProviderError } from "@/lib/providers/errors";
import {
  createPlaidProvider,
  mapPlaidAccount,
  mapPlaidAccountType,
  mapPlaidTransaction,
  type PlaidClientLike,
} from "@/lib/providers/plaid";

const CREDENTIALS = { clientId: "client-123", secret: "secret-456", env: "sandbox" as const };
const LINKED = { ...CREDENTIALS, accessToken: "access-sandbox-abc" };

// ---------- fixtures ----------

function account(overrides: Partial<AccountBase> = {}): AccountBase {
  return {
    account_id: "acc-1",
    name: "Plaid Checking",
    official_name: "Plaid Gold Standard 0% Interest Checking",
    mask: "0000",
    type: PlaidAccountType.Depository,
    subtype: AccountSubtype.Checking,
    balances: {
      available: 100.5,
      current: 110.25,
      limit: null,
      iso_currency_code: "USD",
      unofficial_currency_code: null,
    },
    ...overrides,
  } as AccountBase;
}

function transaction(overrides: Partial<PlaidTransaction> = {}): PlaidTransaction {
  return {
    account_id: "acc-1",
    transaction_id: "txn-1",
    amount: 12.34,
    iso_currency_code: "USD",
    unofficial_currency_code: null,
    date: "2024-03-02",
    name: "WHOLE FOODS",
    merchant_name: "Whole Foods",
    pending: false,
    pending_transaction_id: null,
    account_owner: null,
    authorized_date: null,
    authorized_datetime: null,
    datetime: null,
    location: {},
    payment_meta: {},
    transaction_code: null,
    ...overrides,
  } as unknown as PlaidTransaction;
}

interface RecordedCalls {
  itemGet: Array<{ access_token: string }>;
  accountsGet: Array<{ access_token: string }>;
  transactionsSync: TransactionsSyncRequest[];
  linkTokenCreate: LinkTokenCreateRequest[];
  itemPublicTokenExchange: Array<{ public_token: string }>;
}

interface StubOptions {
  syncPages?: Array<Partial<TransactionsSyncResponse>>;
  accounts?: AccountBase[];
  throws?: unknown;
}

function stubClient(options: StubOptions = {}): { client: PlaidClientLike; calls: RecordedCalls } {
  const calls: RecordedCalls = {
    itemGet: [],
    accountsGet: [],
    transactionsSync: [],
    linkTokenCreate: [],
    itemPublicTokenExchange: [],
  };
  const boom = () => {
    if (options.throws) throw options.throws;
  };
  let page = 0;

  const client: PlaidClientLike = {
    async itemGet(req) {
      calls.itemGet.push({ access_token: req.access_token });
      boom();
      return { data: { item: { item_id: "item-1", institution_id: "ins_109508" } } as ItemGetResponse };
    },
    async accountsGet(req) {
      calls.accountsGet.push({ access_token: req.access_token });
      boom();
      return { data: { accounts: options.accounts ?? [account()] } as AccountsGetResponse };
    },
    async transactionsSync(req) {
      calls.transactionsSync.push({ ...req });
      boom();
      const pages = options.syncPages ?? [{}];
      const current = pages[Math.min(page, pages.length - 1)];
      page += 1;
      return {
        data: {
          accounts: [],
          added: [],
          modified: [],
          removed: [],
          next_cursor: "cursor-end",
          has_more: false,
          ...current,
        } as TransactionsSyncResponse,
      };
    },
    async linkTokenCreate(req) {
      calls.linkTokenCreate.push(req);
      boom();
      return {
        data: {
          link_token: "link-sandbox-1",
          expiration: "2024-03-02T12:00:00Z",
          request_id: "req-1",
        } as LinkTokenCreateResponse,
      };
    },
    async itemPublicTokenExchange(req) {
      calls.itemPublicTokenExchange.push({ public_token: req.public_token });
      boom();
      return {
        data: {
          access_token: "access-sandbox-new",
          item_id: "item-9",
          request_id: "req-2",
        } as ItemPublicTokenExchangeResponse,
      };
    },
  };

  return { client, calls };
}

function providerWith(options: StubOptions = {}) {
  const { client, calls } = stubClient(options);
  return { provider: createPlaidProvider({ createClient: () => client }), calls };
}

// ---------- mapping ----------

describe("mapPlaidAccountType", () => {
  it.each([
    ["depository", "checking", "checking"],
    ["depository", "savings", "savings"],
    ["depository", "cd", "savings"],
    ["depository", "money market", "savings"],
    ["depository", "hsa", "savings"],
    ["depository", "prepaid", "cash"],
    ["depository", "paypal", "cash"],
    ["depository", null, "checking"],
    ["credit", "credit card", "credit"],
    ["loan", "mortgage", "loan"],
    ["loan", "student", "loan"],
    ["investment", "ira", "investment"],
    ["brokerage", null, "investment"],
    ["other", null, "other"],
    ["something-new", "unknown", "other"],
  ])("maps %s/%s to %s", (type, subtype, expected) => {
    expect(mapPlaidAccountType(type, subtype)).toBe(expected);
  });

  it("tolerates missing type information", () => {
    expect(mapPlaidAccountType(null)).toBe("other");
    expect(mapPlaidAccountType(undefined, undefined)).toBe("other");
  });
});

describe("mapPlaidAccount", () => {
  it("converts balances to minor units", () => {
    expect(mapPlaidAccount(account())).toEqual({
      externalId: "acc-1",
      name: "Plaid Checking",
      officialName: "Plaid Gold Standard 0% Interest Checking",
      type: "checking",
      currency: "USD",
      balance: 11025,
      available: 10050,
      institution: null,
      mask: "0000",
    });
  });

  it("keeps a null available balance null rather than zero", () => {
    const mapped = mapPlaidAccount(
      account({ balances: { available: null, current: 0, limit: null, iso_currency_code: null, unofficial_currency_code: null } }),
    );
    expect(mapped.available).toBeNull();
    expect(mapped.balance).toBe(0);
    expect(mapped.currency).toBe("USD");
  });

  it("reports credit balances with Plaid's sign, letting account type carry liability", () => {
    const card = mapPlaidAccount(
      account({
        type: PlaidAccountType.Credit,
        subtype: AccountSubtype.CreditCard,
        balances: { available: null, current: 450.25, limit: 2000, iso_currency_code: "USD", unofficial_currency_code: null },
      }),
    );
    expect(card.type).toBe("credit");
    expect(card.balance).toBe(45025);
  });

  it("attaches an institution name when the caller knows one", () => {
    expect(mapPlaidAccount(account(), "Chase").institution).toBe("Chase");
  });
});

describe("mapPlaidTransaction", () => {
  it("inverts Plaid's sign so outflow is negative", () => {
    expect(mapPlaidTransaction(transaction())).toEqual({
      externalId: "txn-1",
      accountExternalId: "acc-1",
      amount: -1234,
      currency: "USD",
      date: "2024-03-02",
      name: "WHOLE FOODS",
      merchant: "Whole Foods",
      pending: false,
    });
  });

  it("turns a Plaid refund (negative) into a positive inflow", () => {
    expect(mapPlaidTransaction(transaction({ amount: -50 })).amount).toBe(5000);
  });

  it("falls back through name, merchant and currency gaps", () => {
    const mapped = mapPlaidTransaction(
      transaction({
        name: "",
        merchant_name: null,
        iso_currency_code: null,
        unofficial_currency_code: null,
        pending: true,
        date: "2024-03-02T00:00:00Z",
      }),
    );
    expect(mapped.name).toBe("Transaction");
    expect(mapped.merchant).toBeNull();
    expect(mapped.currency).toBe("USD");
    expect(mapped.pending).toBe(true);
    expect(mapped.date).toBe("2024-03-02");
  });
});

// ---------- provider behaviour ----------

describe("plaid provider", () => {
  it("validates credentials before making any call", async () => {
    const { provider, calls } = providerWith();
    const result = await provider.test({ clientId: "", secret: "x" });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Invalid Plaid credentials/);
    expect(calls.linkTokenCreate).toHaveLength(0);
    expect(calls.itemGet).toHaveLength(0);
  });

  it("tests un-linked credentials with a link token, which mutates nothing", async () => {
    const { provider, calls } = providerWith();
    const result = await provider.test(CREDENTIALS);
    expect(result.ok).toBe(true);
    expect(calls.linkTokenCreate).toHaveLength(1);
    expect(calls.itemGet).toHaveLength(0);
  });

  it("tests linked credentials with itemGet and reports the institution", async () => {
    const { provider, calls } = providerWith();
    const result = await provider.test(LINKED);
    expect(result.ok).toBe(true);
    expect(result.message).toContain("ins_109508");
    expect(calls.itemGet).toEqual([{ access_token: "access-sandbox-abc" }]);
  });

  it("surfaces Plaid's error code without echoing the request", async () => {
    const { provider } = providerWith({
      throws: {
        response: {
          data: {
            error_code: "INVALID_API_KEYS",
            error_message: "invalid client_id or secret provided",
            display_message: null,
          },
        },
      },
    });
    const result = await provider.test(CREDENTIALS);
    expect(result.ok).toBe(false);
    expect(result.message).toBe("invalid client_id or secret provided (INVALID_API_KEYS)");
    expect(result.message).not.toContain("secret-456");
  });

  it("lists accounts for a linked item", async () => {
    const { provider, calls } = providerWith({
      accounts: [account(), account({ account_id: "acc-2", type: PlaidAccountType.Credit, subtype: AccountSubtype.CreditCard })],
    });
    const accounts = await provider.listAccounts(LINKED);
    expect(accounts.map((a) => a.type)).toEqual(["checking", "credit"]);
    expect(calls.accountsGet).toEqual([{ access_token: "access-sandbox-abc" }]);
  });

  it("refuses to list accounts before the Link flow has run", async () => {
    const { provider, calls } = providerWith();
    await expect(provider.listAccounts(CREDENTIALS)).rejects.toThrow(ProviderError);
    await expect(provider.listAccounts(CREDENTIALS)).rejects.toMatchObject({ code: "reauth_required" });
    expect(calls.accountsGet).toHaveLength(0);
  });

  it("pages through /transactions/sync and returns the final cursor", async () => {
    const { provider, calls } = providerWith({
      syncPages: [
        {
          added: [transaction({ transaction_id: "t1" })],
          modified: [],
          removed: [],
          next_cursor: "cursor-1",
          has_more: true,
        },
        {
          accounts: [account()],
          added: [transaction({ transaction_id: "t2", amount: -20 })],
          modified: [transaction({ transaction_id: "t3", amount: 5 })],
          removed: [{ transaction_id: "t0", account_id: "acc-1" }],
          next_cursor: "cursor-2",
          has_more: false,
        },
      ],
    });

    const result = await provider.sync(LINKED, "cursor-0");

    expect(calls.transactionsSync).toEqual([
      { access_token: "access-sandbox-abc", cursor: "cursor-0" },
      { access_token: "access-sandbox-abc", cursor: "cursor-1" },
    ]);
    expect(result.added.map((t) => t.externalId)).toEqual(["t1", "t2"]);
    expect(result.added[1].amount).toBe(2000);
    expect(result.modified.map((t) => t.externalId)).toEqual(["t3"]);
    expect(result.removedExternalIds).toEqual(["t0"]);
    expect(result.accounts).toHaveLength(1);
    expect(result.nextCursor).toBe("cursor-2");
  });

  it("omits the cursor on a first sync", async () => {
    const { provider, calls } = providerWith();
    const result = await provider.sync(LINKED, null);
    expect(calls.transactionsSync).toEqual([{ access_token: "access-sandbox-abc" }]);
    expect(result.added).toEqual([]);
    expect(result.nextCursor).toBe("cursor-end");
  });

  it("stops after maxSyncPages instead of looping forever on has_more", async () => {
    const { client, calls } = stubClient({
      syncPages: [{ added: [transaction()], next_cursor: "c", has_more: true }],
    });
    const provider = createPlaidProvider({ createClient: () => client, maxSyncPages: 3 });
    const result = await provider.sync(LINKED, null);
    expect(calls.transactionsSync).toHaveLength(3);
    expect(result.added).toHaveLength(3);
  });

  it("wraps sync failures as ProviderError carrying Plaid's code", async () => {
    const { provider } = providerWith({
      throws: { response: { data: { error_code: "ITEM_LOGIN_REQUIRED", error_message: "the login details have changed" } } },
    });
    await expect(provider.sync(LINKED, null)).rejects.toMatchObject({
      code: "item_login_required",
      provider: "plaid",
    });
  });

  it("creates a Link token for a first-time connection", async () => {
    const { provider, calls } = providerWith();
    const result = await provider.createLinkToken(CREDENTIALS, { clientUserId: "user-1" });
    expect(result).toEqual({ linkToken: "link-sandbox-1", expiration: "2024-03-02T12:00:00Z" });
    expect(calls.linkTokenCreate[0]).toMatchObject({
      client_name: "Moneta",
      language: "en",
      country_codes: ["US"],
      products: ["transactions"],
      user: { client_user_id: "user-1" },
    });
  });

  it("creates an update-mode Link token when an access token already exists", async () => {
    const { provider, calls } = providerWith();
    await provider.createLinkToken(LINKED);
    expect(calls.linkTokenCreate[0].access_token).toBe("access-sandbox-abc");
    expect(calls.linkTokenCreate[0].products).toBeUndefined();
  });

  it("exchanges a public token for an access token", async () => {
    const { provider, calls } = providerWith();
    const result = await provider.exchangePublicToken(CREDENTIALS, "public-sandbox-xyz");
    expect(result).toEqual({ accessToken: "access-sandbox-new", itemId: "item-9" });
    expect(calls.itemPublicTokenExchange).toEqual([{ public_token: "public-sandbox-xyz" }]);
  });

  it("rejects an empty public token before calling Plaid", async () => {
    const { provider, calls } = providerWith();
    await expect(provider.exchangePublicToken(CREDENTIALS, "  ")).rejects.toThrow(ProviderError);
    expect(calls.itemPublicTokenExchange).toHaveLength(0);
  });

  it("defaults env to sandbox", async () => {
    const { provider } = providerWith();
    const result = await provider.test({ clientId: "a", secret: "b" });
    expect(result.message).toContain("sandbox");
  });
});
