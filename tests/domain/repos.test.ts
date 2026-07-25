import { beforeEach, describe, expect, it } from "vitest";
import { closeDb, createTestDb, type Db } from "@/db";
import {
  countUsers,
  createConnection,
  createUser,
  deleteConnection,
  dismissInsight,
  findAccountByExternalId,
  findUserByUsername,
  getConnection,
  getCredentialsEnc,
  getTransaction,
  listAccounts,
  listConnections,
  listInsights,
  listTransactions,
  markSynced,
  needsSetup,
  setCredentialsEnc,
  updateAccount,
  updateTransaction,
  upsertInsight,
  upsertProviderAccount,
  upsertProviderTransaction,
} from "@/lib/domain/repos";
import { insertAccount, insertTx } from "./helpers";

describe("repositories", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
    return () => closeDb(db);
  });

  describe("users", () => {
    it("reports first-run setup until a user exists", () => {
      expect(needsSetup(db)).toBe(true);
      createUser(db, { username: "Sam", passwordHash: "hash" });
      expect(needsSetup(db)).toBe(false);
      expect(countUsers(db)).toBe(1);
    });

    it("looks up users case-insensitively", () => {
      createUser(db, { username: "Sam", passwordHash: "hash" });
      expect(findUserByUsername(db, "SAM")?.passwordHash).toBe("hash");
      expect(findUserByUsername(db, "nobody")).toBeNull();
    });
  });

  describe("accounts", () => {
    it("hides archived accounts unless asked", () => {
      const a = insertAccount(db, { name: "Checking" });
      insertAccount(db, { name: "Old Card", type: "credit" });
      updateAccount(db, a.id, { archived: true });
      expect(listAccounts(db).map((x) => x.name)).toEqual(["Old Card"]);
      expect(listAccounts(db, { includeArchived: true })).toHaveLength(2);
    });

    it("upserts provider accounts idempotently without resurrecting archives", () => {
      const connection = createConnection(db, { provider: "simplefin" });
      const pa = {
        externalId: "ext-acct-1",
        name: "Chase Checking",
        officialName: null,
        type: "checking" as const,
        currency: "USD",
        balance: 100_000,
        available: null,
        institution: "Chase",
        mask: "1234",
      };
      const first = upsertProviderAccount(db, connection.id, pa);
      updateAccount(db, first.id, { archived: true });
      const second = upsertProviderAccount(db, connection.id, {
        ...pa,
        balance: 90_000,
      });
      expect(second.id).toBe(first.id);
      expect(second.balance).toBe(90_000);
      expect(second.archived).toBe(true);
      expect(listAccounts(db, { includeArchived: true })).toHaveLength(1);
      expect(
        findAccountByExternalId(db, connection.id, "ext-acct-1")?.id,
      ).toBe(first.id);
    });
  });

  describe("transactions", () => {
    it("filters by account, category, date range and text", () => {
      const a = insertAccount(db, { name: "A" });
      const b = insertAccount(db, { name: "B" });
      insertTx(db, a.id, {
        name: "BLUE BOTTLE COFFEE",
        date: "2026-07-02",
        categoryId: "cat_coffee",
      });
      insertTx(db, a.id, {
        name: "Whole Foods",
        merchant: "Whole Foods Market",
        date: "2026-07-15",
        categoryId: "cat_groceries",
      });
      insertTx(db, b.id, { name: "Rent", date: "2026-06-01" });

      expect(listTransactions(db, { accountId: a.id }).total).toBe(2);
      expect(listTransactions(db, { categoryId: "cat_coffee" }).total).toBe(1);
      expect(
        listTransactions(db, { from: "2026-07-01", to: "2026-07-31" }).total,
      ).toBe(2);
      expect(listTransactions(db, { q: "coffee" }).total).toBe(1);
      expect(listTransactions(db, { q: "whole foods market" }).total).toBe(1);
      expect(listTransactions(db, { q: "nothing" }).total).toBe(0);
    });

    it("treats LIKE wildcards in the query as literal text", () => {
      const a = insertAccount(db);
      insertTx(db, a.id, { name: "100% Chiropractic" });
      insertTx(db, a.id, { name: "Regular charge" });
      expect(listTransactions(db, { q: "%" }).total).toBe(1);
    });

    it("paginates newest first and reports the unpaged total", () => {
      const a = insertAccount(db);
      for (let day = 1; day <= 5; day++) {
        insertTx(db, a.id, {
          name: `Day ${day}`,
          date: `2026-07-0${day}`,
        });
      }
      const page = listTransactions(db, { limit: 2, offset: 0 });
      expect(page.total).toBe(5);
      expect(page.limit).toBe(2);
      expect(page.items.map((t) => t.name)).toEqual(["Day 5", "Day 4"]);
      const next = listTransactions(db, { limit: 2, offset: 2 });
      expect(next.items.map((t) => t.name)).toEqual(["Day 3", "Day 2"]);
      expect(next.offset).toBe(2);
    });

    it("marks a category set through the API as user-owned", () => {
      const a = insertAccount(db);
      const tx = insertTx(db, a.id, { name: "Corner Store" });
      updateTransaction(db, tx.id, { categoryId: "cat_groceries" });
      const raw = db.$client
        .prepare("select category_source from transactions where id = ?")
        .get(tx.id) as { category_source: string };
      expect(raw.category_source).toBe("user");
    });

    it("keeps a user category when a provider re-sends the transaction", () => {
      const a = insertAccount(db);
      const created = upsertProviderTransaction(db, a.id, {
        externalId: "ext-1",
        accountExternalId: "x",
        amount: -2_500,
        currency: "USD",
        date: "2026-07-02",
        name: "AMZN Mktp",
        merchant: "Amazon",
        pending: true,
      });
      expect(created.created).toBe(true);
      updateTransaction(db, created.transaction.id, {
        categoryId: "cat_gifts",
      });
      const again = upsertProviderTransaction(db, a.id, {
        externalId: "ext-1",
        accountExternalId: "x",
        amount: -2_500,
        currency: "USD",
        date: "2026-07-03",
        name: "AMZN Mktp US",
        merchant: "Amazon",
        pending: false,
      });
      expect(again.created).toBe(false);
      const stored = getTransaction(db, created.transaction.id)!;
      expect(stored.categoryId).toBe("cat_gifts");
      expect(stored.pending).toBe(false);
      expect(stored.date).toBe("2026-07-03");
    });
  });

  describe("connections", () => {
    it("stores encrypted credentials outside the Connection contract", () => {
      const c = createConnection(db, {
        provider: "plaid",
        institution: "Chase",
        credentialsEnc: "enc:v1:abc",
      });
      expect(c).not.toHaveProperty("credentialsEnc");
      expect(getCredentialsEnc(db, c.id)).toBe("enc:v1:abc");
      setCredentialsEnc(db, c.id, "enc:v1:def");
      expect(getCredentialsEnc(db, c.id)).toBe("enc:v1:def");
    });

    it("records sync progress and clears the error state", () => {
      const c = createConnection(db, { provider: "simplefin" });
      const synced = markSynced(db, c.id, "cursor-2")!;
      expect(synced.status).toBe("ok");
      expect(synced.lastSyncAt).not.toBeNull();
      expect(listConnections(db)).toHaveLength(1);
      deleteConnection(db, c.id);
      expect(getConnection(db, c.id)).toBeNull();
    });

    it("keeps accounts as manual entries when a connection is deleted", () => {
      const c = createConnection(db, { provider: "teller" });
      const account = upsertProviderAccount(db, c.id, {
        externalId: "ext-1",
        name: "Savings",
        officialName: null,
        type: "savings",
        currency: "USD",
        balance: 1_000,
        available: null,
        institution: null,
        mask: null,
      });
      deleteConnection(db, c.id);
      const [kept] = listAccounts(db);
      expect(kept!.id).toBe(account.id);
      expect(kept!.connectionId).toBeNull();
    });
  });

  describe("insights", () => {
    const draft = {
      kind: "savings_rate" as const,
      severity: "warn" as const,
      title: "Savings rate is low",
      body: "body",
      action: "Save more",
      refs: {},
      period: "2026-07",
      dedupeKey: "savings_rate",
    };

    it("upserts on (period, kind, key) instead of duplicating", () => {
      const first = upsertInsight(db, draft);
      const second = upsertInsight(db, { ...draft, title: "Updated" });
      expect(second.id).toBe(first.id);
      expect(listInsights(db, { period: "2026-07" })).toHaveLength(1);
      expect(listInsights(db)[0]!.title).toBe("Updated");
    });

    it("keeps an insight dismissed when the engine recomputes it", () => {
      const first = upsertInsight(db, draft);
      expect(dismissInsight(db, first.id)).toBe(true);
      upsertInsight(db, { ...draft, title: "Recomputed" });
      expect(listInsights(db, { period: "2026-07" })).toHaveLength(0);
      expect(
        listInsights(db, { period: "2026-07", includeDismissed: true }),
      ).toHaveLength(1);
    });
  });
});
