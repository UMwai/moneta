import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { closeDb, createTestDb, schema, type Db } from "@/db";
import { periodOf, todayISO } from "@/lib/domain/dates";
import { getCredentialsEnc } from "@/lib/domain/repos";
import { setProviderResolver } from "@/lib/server/providers";
import { encryptCredentials } from "@/lib/server/secrets";
import { DrizzleStore } from "@/lib/server/store";
import { SyncFailedError } from "@/lib/server/sync";

import {
  GOOD_CREDENTIALS,
  createFakeBank,
  type FakeBank,
} from "./fake-bank";

const KEY = "a".repeat(64);
const PERIOD = periodOf(todayISO());

describe("integration: connection -> sync -> ledger -> insights", () => {
  const originalKey = process.env.APP_ENCRYPTION_KEY;
  let db: Db;
  let store: DrizzleStore;
  let bank: FakeBank;

  beforeAll(() => {
    process.env.APP_ENCRYPTION_KEY = KEY;
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = originalKey;
  });

  beforeEach(() => {
    db = createTestDb();
    store = new DrizzleStore(db);
    bank = createFakeBank();
    setProviderResolver(() => bank);
  });

  afterEach(() => {
    setProviderResolver(null);
    closeDb(db);
  });

  it("sets up the single user and refuses a second one", async () => {
    await expect(store.hasUser()).resolves.toBe(false);
    const user = await store.createUser("ada", "hash:argon2id");
    expect(user).toMatchObject({ username: "ada" });
    await expect(store.hasUser()).resolves.toBe(true);
    await expect(store.findUserByUsername("ada")).resolves.toMatchObject({
      passwordHash: "hash:argon2id",
    });
    await expect(store.createUser("bob", "hash:other")).rejects.toThrow(
      /already exists/i,
    );
  });

  it("stores credentials encrypted and can still decrypt them to sync", async () => {
    const connection = await store.createConnection(
      "simplefin",
      encryptCredentials(GOOD_CREDENTIALS),
    );

    const blob = getCredentialsEnc(db, connection.id);
    expect(blob).toBeTruthy();
    expect(blob).toMatch(/^v1:/);
    // The point of the check: nothing recognisable from the plaintext survives.
    expect(blob).not.toContain(GOOD_CREDENTIALS.accessKey);
    expect(blob).not.toContain(GOOD_CREDENTIALS.setupToken);
    expect(blob).not.toContain("accessKey");

    await store.syncConnection(connection.id);
    // The adapter only gets here if the blob round-tripped.
    expect(bank.calls.sync).toBe(1);
  });

  it("adds nothing on a second sync of the same window", async () => {
    const connection = await store.createConnection(
      "simplefin",
      encryptCredentials(GOOD_CREDENTIALS),
    );

    const first = await store.syncConnection(connection.id);
    expect(first.added).toBeGreaterThan(0);
    expect(first.modified).toBe(0);

    const before = await store.listTransactions({ limit: 200, offset: 0 });

    const second = await store.syncConnection(connection.id);
    expect(second.added).toBe(0);
    expect(second.modified).toBe(first.added);

    const after = await store.listTransactions({ limit: 200, offset: 0 });
    expect(after.total).toBe(before.total);

    // The cursor from the first run has to reach the adapter on the second.
    expect(bank.cursorsSeen).toEqual([null, "cursor-1"]);
    const [refreshed] = await store.listConnections();
    expect(refreshed.status).toBe("ok");
    expect(refreshed.lastSyncAt).toBeTruthy();
  });

  it("links provider accounts by externalId instead of duplicating them", async () => {
    const connection = await store.createConnection(
      "simplefin",
      encryptCredentials(GOOD_CREDENTIALS),
    );
    await store.syncConnection(connection.id);
    await store.syncConnection(connection.id);

    const accounts = await store.listAccounts();
    expect(accounts).toHaveLength(2);
    expect(accounts.every((account) => account.connectionId === connection.id)).toBe(
      true,
    );
    expect(accounts.map((account) => account.name).sort()).toEqual([
      "Everyday Checking",
      "Rewards Card",
    ]);
  });

  it("marks the connection unhealthy when the provider fails", async () => {
    const connection = await store.createConnection(
      "simplefin",
      encryptCredentials(GOOD_CREDENTIALS),
    );
    bank.failNextSyncWith(new Error("upstream exploded"));

    await expect(store.syncConnection(connection.id)).rejects.toBeInstanceOf(
      SyncFailedError,
    );

    const [failed] = await store.listConnections();
    expect(failed.status).toBe("error");
    expect(failed.lastSyncAt).toBeNull();
  });

  it("never parks a provider's raw error text in last_error", async () => {
    const connection = await store.createConnection(
      "simplefin",
      encryptCredentials(GOOD_CREDENTIALS),
    );
    // What undici throws when handed a SimpleFIN access URL it cannot parse:
    // the message quotes the URL, userinfo included, and last_error is stored
    // in the clear.
    bank.failNextSyncWith(
      new TypeError(
        "Failed to parse URL from https://user:s3cret@bridge.example.com/simplefin",
      ),
    );

    await expect(store.syncConnection(connection.id)).rejects.toBeInstanceOf(
      SyncFailedError,
    );

    const stored = db
      .select({ lastError: schema.connections.lastError })
      .from(schema.connections)
      .get();
    expect(stored?.lastError).toBe("The provider could not be reached.");
  });

  describe("after a sync", () => {
    let connectionId: string;

    beforeEach(async () => {
      const connection = await store.createConnection(
        "simplefin",
        encryptCredentials(GOOD_CREDENTIALS),
      );
      connectionId = connection.id;
      await store.syncConnection(connectionId);
    });

    it("serves transactions through the query filters", async () => {
      const all = await store.listTransactions({ limit: 200, offset: 0 });
      expect(all.total).toBeGreaterThan(5);

      const byText = await store.listTransactions({
        q: "whole foods",
        limit: 50,
        offset: 0,
      });
      expect(byText.total).toBe(1);
      expect(byText.items[0].name).toContain("WHOLE FOODS");

      const accounts = await store.listAccounts();
      const card = accounts.find((account) => account.mask === "9876");
      expect(card).toBeDefined();
      const byAccount = await store.listTransactions({
        accountId: card!.id,
        limit: 50,
        offset: 0,
      });
      expect(byAccount.total).toBeGreaterThan(0);
      expect(
        byAccount.items.every((item) => item.accountId === card!.id),
      ).toBe(true);

      const byCategory = await store.listTransactions({
        categoryId: "cat_groceries",
        limit: 50,
        offset: 0,
      });
      expect(byCategory.total).toBe(2);

      const page = await store.listTransactions({ limit: 2, offset: 0 });
      expect(page.items).toHaveLength(2);
      expect(page).toMatchObject({ total: all.total, limit: 2, offset: 0 });
    });

    it("auto-categorises what it can and never overwrites a user's choice", async () => {
      const groceries = await store.listTransactions({
        q: "trader joes",
        limit: 5,
        offset: 0,
      });
      const target = groceries.items[0];
      expect(target.categoryId).toBe("cat_groceries");

      const moved = await store.updateTransaction(target.id, {
        categoryId: "cat_restaurants",
        notes: "actually a prepared meal",
      });
      expect(moved).toMatchObject({
        categoryId: "cat_restaurants",
        notes: "actually a prepared meal",
      });

      // Re-running the whole pipeline must leave the human decision alone.
      await store.syncConnection(connectionId);
      const after = await store.listTransactions({
        q: "trader joes",
        limit: 5,
        offset: 0,
      });
      expect(after.items[0].categoryId).toBe("cat_restaurants");
    });

    it("reflects the synced spend in budget status", async () => {
      const budget = await store.upsertBudget("cat_groceries", PERIOD, 20_000);
      expect(budget).toMatchObject({ categoryId: "cat_groceries", amount: 20_000 });

      const statuses = await store.listBudgetStatuses(PERIOD);
      const groceries = statuses.find(
        (status) => status.categoryId === "cat_groceries",
      );
      expect(groceries).toBeDefined();
      // 8_500 + 4_512 from the fake feed, both inside the current period.
      expect(groceries!.spent).toBe(13_012);
      expect(groceries!.amount).toBe(20_000);
      expect(groceries!.remaining).toBe(6_988);
    });

    it("detects the monthly series, snapshots net worth and writes insights", async () => {
      const recurring = await store.listRecurring();
      const netflix = recurring.find((series) =>
        series.name.toLowerCase().includes("netflix"),
      );
      expect(netflix).toBeDefined();
      expect(netflix!.cadence).toBe("monthly");
      expect(netflix!.amount).toBe(-1_599);

      const points = await store.listNetWorth();
      expect(points).toHaveLength(1);
      expect(points[0].date).toBe(todayISO());
      // Checking balance plus the negative card balance.
      expect(points[0].net).toBe(812_345 - 45_600);

      const insights = await store.listInsights(PERIOD);
      expect(insights.length).toBeGreaterThan(0);
      expect(insights.every((insight) => insight.period === PERIOD)).toBe(true);
      expect(insights.map((insight) => insight.kind)).toContain("savings_rate");

      const dismissed = await store.dismissInsight(insights[0].id);
      expect(dismissed).toBe(true);
      // A dismissal has to survive the next pipeline run: the engine re-upserts
      // the same (period, kind, dedupeKey) row, and it must stay dismissed
      // rather than reappearing as a fresh insight.
      await store.syncConnection(connectionId);
      const again = await store.listInsights(PERIOD);
      expect(again.map((insight) => insight.id)).not.toContain(insights[0].id);
      expect(again).toHaveLength(insights.length - 1);
    });
  });
});
