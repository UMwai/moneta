import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { periodOf, todayISO } from "@/lib/domain/dates";
import { setProviderResolver } from "@/lib/server/providers";

import {
  BAD_CREDENTIALS,
  GOOD_CREDENTIALS,
  createFakeBank,
  type FakeBank,
} from "./fake-bank";

// The singleton store resolves its database lazily from the environment, so the
// env has to be in place before any module in the graph is imported. `:memory:`
// is special-cased by createDb, which keeps this off the filesystem entirely.
vi.hoisted(() => {
  process.env.DATABASE_PATH = ":memory:";
  process.env.APP_ENCRYPTION_KEY = "b".repeat(64);
  process.env.SESSION_SECRET = "test-session-secret-that-is-long-enough";
});

// Route handlers run outside a request scope here, so next/headers cookies()
// is unavailable; only the cookie read needs stubbing, not the rest of the
// module — the session-version check against the user row stays live, so the
// claims below are filled in from the real row created in beforeAll.
const { sessionUser } = vi.hoisted(() => ({
  sessionUser: { id: "user_test", username: "ada", sessionVersion: 1 },
}));

vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...actual,
    requireSession: vi.fn(async () => sessionUser),
  };
});

const { POST: createConnection } = await import("@/app/api/connections/route");
const { POST: syncConnection } = await import(
  "@/app/api/connections/[id]/sync/route"
);
const { POST: importFile } = await import("@/app/api/import/csv/route");
const { GET: listTransactions } = await import("@/app/api/transactions/route");
const { GET: listBudgets, PUT: putBudget } = await import(
  "@/app/api/budgets/route"
);
const { GET: listAccounts } = await import("@/app/api/accounts/route");
const { GET: listInsights } = await import("@/app/api/insights/route");

const PERIOD = periodOf(todayISO());

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function uploadRequest(filename: string, contents: string, accountId?: string) {
  const form = new FormData();
  form.set("file", new File([contents], filename, { type: "text/plain" }));
  if (accountId) form.set("accountId", accountId);
  return new Request("http://localhost/api/import/csv", {
    method: "POST",
    body: form,
  });
}

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe("integration: REST handlers over the real store", () => {
  let bank: FakeBank;

  beforeAll(async () => {
    bank = createFakeBank();
    setProviderResolver(() => bank);

    const { store } = await import("@/lib/server/store");
    const user = await store.createUser("ada", "hash:argon2id");
    sessionUser.id = user.id;
    sessionUser.sessionVersion = user.sessionVersion;
  });

  afterAll(() => {
    setProviderResolver(null);
  });

  it("rejects credentials the provider refuses, and stores the ones it accepts", async () => {
    const rejected = await createConnection(
      jsonRequest("http://localhost/api/connections", {
        provider: "simplefin",
        credentials: BAD_CREDENTIALS,
      }),
    );
    expect(rejected.status).toBe(400);
    expect(await body(rejected)).toMatchObject({
      error: { code: "PROVIDER_TEST_FAILED" },
    });

    const accepted = await createConnection(
      jsonRequest("http://localhost/api/connections", {
        provider: "simplefin",
        credentials: GOOD_CREDENTIALS,
      }),
    );
    expect(accepted.status).toBe(201);
    const connection = await body<{ id: string; status: string }>(accepted);
    expect(connection).toMatchObject({ provider: "simplefin", status: "ok" });

    // A connection is only created for credentials that passed test().
    const listed = await listAccounts();
    expect(listed.status).toBe(200);

    const syncContext = { params: Promise.resolve({ id: connection.id }) };
    const first = await syncConnection(
      new Request("http://localhost/api/connections/x/sync", { method: "POST" }),
      syncContext,
    );
    expect(first.status).toBe(200);
    const firstResult = await body<{ added: number; modified: number }>(first);
    expect(firstResult.added).toBeGreaterThan(0);

    const second = await syncConnection(
      new Request("http://localhost/api/connections/x/sync", { method: "POST" }),
      { params: Promise.resolve({ id: connection.id }) },
    );
    expect(await body(second)).toEqual({
      added: 0,
      modified: firstResult.added,
    });
  });

  it("404s a sync of a connection that does not exist", async () => {
    const response = await syncConnection(
      new Request("http://localhost/api/connections/nope/sync", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "conn_missing" }) },
    );
    expect(response.status).toBe(404);
    expect(await body(response)).toMatchObject({
      error: { code: "CONNECTION_NOT_FOUND" },
    });
  });

  it("serves the synced ledger through the transactions query", async () => {
    const response = await listTransactions(
      new NextRequest(
        "http://localhost/api/transactions?q=netflix&limit=10&offset=0",
      ),
    );
    expect(response.status).toBe(200);
    const page = await body<{ total: number; items: { name: string }[] }>(
      response,
    );
    expect(page.total).toBe(4);
    expect(page.items.every((item) => item.name.includes("NETFLIX"))).toBe(true);
  });

  it("reports budget status against the synced spend", async () => {
    const put = await putBudget(
      jsonRequest("http://localhost/api/budgets", {
        categoryId: "cat_groceries",
        month: PERIOD,
        amount: 20_000,
      }),
    );
    expect(put.status).toBe(200);

    const response = await listBudgets(
      new NextRequest(`http://localhost/api/budgets?month=${PERIOD}`),
    );
    const statuses = await body<
      { categoryId: string; spent: number; amount: number }[]
    >(response);
    const groceries = statuses.find((s) => s.categoryId === "cat_groceries");
    expect(groceries).toMatchObject({ spent: 13_012, amount: 20_000 });
  });

  it("returns insights for the current period", async () => {
    const response = await listInsights(
      new NextRequest(`http://localhost/api/insights?period=${PERIOD}`),
    );
    expect(response.status).toBe(200);
    const insights = await body<{ kind: string; period: string }[]>(response);
    expect(insights.length).toBeGreaterThan(0);
    expect(insights.map((insight) => insight.kind)).toContain("savings_rate");
  });

  it("imports a CSV once and treats a re-upload as a no-op", async () => {
    const csv = [
      "Date,Description,Amount,Category",
      "2026-02-03,CVS PHARMACY 4410,-24.18,Pharmacy",
      "2026-02-05,SHELL OIL 9902,-52.40,Gas",
    ].join("\n");

    const first = await importFile(uploadRequest("statement.csv", csv));
    expect(first.status).toBe(200);
    expect(await body(first)).toEqual({ imported: 2 });

    const again = await importFile(uploadRequest("statement.csv", csv));
    expect(await body(again)).toEqual({ imported: 0 });

    const response = await listTransactions(
      new NextRequest("http://localhost/api/transactions?q=shell&limit=10&offset=0"),
    );
    const page = await body<{ total: number; items: { categoryId: string }[] }>(
      response,
    );
    expect(page.total).toBe(1);
    expect(page.items[0].categoryId).toBe("cat_gas");
  });

  it("accepts an OFX upload on the same route", async () => {
    const ofx = [
      "OFXHEADER:100",
      "DATA:OFXSGML",
      "VERSION:102",
      "",
      "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>",
      "<CURDEF>USD",
      "<BANKACCTFROM><BANKID>123456789<ACCTID>000111222<ACCTTYPE>CHECKING</BANKACCTFROM>",
      "<BANKTRANLIST>",
      "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260210<TRNAMT>-31.75<FITID>ofx-1<NAME>IKEA BROOKLYN</STMTTRN>",
      "</BANKTRANLIST>",
      "</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>",
    ].join("\n");

    const response = await importFile(uploadRequest("export.ofx", ofx));
    expect(response.status).toBe(200);
    expect(await body(response)).toEqual({ imported: 1 });

    const listed = await listTransactions(
      new NextRequest("http://localhost/api/transactions?q=ikea&limit=10&offset=0"),
    );
    const page = await body<{ total: number }>(listed);
    expect(page.total).toBe(1);
  });

  it("rejects a file it cannot parse", async () => {
    const response = await importFile(
      uploadRequest("junk.csv", "this is not a statement"),
    );
    expect(response.status).toBe(400);
    expect(await body(response)).toMatchObject({
      error: { code: "INVALID_CSV" },
    });
  });

  it("refuses an oversized upload from its declared length", async () => {
    const form = new FormData();
    form.set("file", new File(["Date,Description,Amount"], "huge.csv"));
    const response = await importFile(
      new Request("http://localhost/api/import/csv", {
        method: "POST",
        body: form,
        // The check has to happen before formData() buffers the body, so the
        // header is what it acts on rather than the parsed file.
        headers: { "content-length": String(5 * 1024 * 1024 + 1) },
      }),
    );

    expect(response.status).toBe(413);
    expect(await body(response)).toMatchObject({
      error: { code: "CSV_TOO_LARGE" },
    });
  });

  it("404s an import aimed at an unknown account", async () => {
    const response = await importFile(
      uploadRequest(
        "statement.csv",
        "Date,Description,Amount\n2026-03-01,Corner Store,-5.00",
        "acct_does_not_exist",
      ),
    );
    expect(response.status).toBe(404);
    expect(await body(response)).toMatchObject({
      error: { code: "ACCOUNT_NOT_FOUND" },
    });
  });
});
