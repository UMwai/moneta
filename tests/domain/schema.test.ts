import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, createTestDb } from "@/db";
import { categories } from "@/db/schema";
import { id } from "@/db/id";
import { seedCategories, CATEGORY_TREE, flattenCategories } from "@/lib/domain/seed";
import { createTransaction, listCategories } from "@/lib/domain/repos";
import { insertAccount } from "./helpers";

describe("schema + migrations", () => {
  it("applies migrations and creates every table", () => {
    const db = createTestDb();
    const names = db
      .all<{ name: string }>(
        sql`select name from sqlite_master where type = 'table' order by name`,
      )
      .map((r) => r.name);
    for (const table of [
      "accounts",
      "budgets",
      "categories",
      "connections",
      "insights",
      "networth_snapshots",
      "recurring_series",
      "transactions",
      "users",
    ]) {
      expect(names).toContain(table);
    }
    closeDb(db);
  });

  it("seeds the system taxonomy and is idempotent", () => {
    const db = createTestDb();
    const first = listCategories(db);
    expect(first.length).toBe(flattenCategories().length);
    expect(first.every((c) => c.system)).toBe(true);
    expect(first.filter((c) => c.parentId === null).length).toBe(
      CATEGORY_TREE.length,
    );

    seedCategories(db);
    seedCategories(db);
    expect(listCategories(db).length).toBe(first.length);
    closeDb(db);
  });

  it("keeps user categories when the seed re-runs", () => {
    const db = createTestDb();
    db.insert(categories)
      .values({
        id: id("cat"),
        name: "Boat",
        parentId: null,
        icon: null,
        discretionary: true,
        system: false,
      })
      .run();
    seedCategories(db);
    expect(listCategories(db).some((c) => c.name === "Boat")).toBe(true);
    closeDb(db);
  });

  it("rejects a duplicate provider transaction on the same account", () => {
    const db = createTestDb();
    const account = insertAccount(db);
    createTransaction(db, {
      accountId: account.id,
      amount: -1_234,
      date: "2026-07-02",
      name: "Coffee",
      externalId: "ext-1",
    });
    expect(() =>
      createTransaction(db, {
        accountId: account.id,
        amount: -1_234,
        date: "2026-07-02",
        name: "Coffee",
        externalId: "ext-1",
      }),
    ).toThrow();
    closeDb(db);
  });

  it("allows many manual transactions with no external id", () => {
    const db = createTestDb();
    const account = insertAccount(db);
    for (let i = 0; i < 3; i++) {
      createTransaction(db, {
        accountId: account.id,
        amount: -100,
        date: "2026-07-02",
        name: `Manual ${i}`,
      });
    }
    expect(
      db.all<{ n: number }>(sql`select count(*) as n from transactions`)[0]!.n,
    ).toBe(3);
    closeDb(db);
  });

  it("cascades transaction deletes when an account is removed", () => {
    const db = createTestDb();
    const account = insertAccount(db);
    createTransaction(db, {
      accountId: account.id,
      amount: -100,
      date: "2026-07-02",
      name: "Manual",
    });
    db.run(sql`delete from accounts where id = ${account.id}`);
    expect(
      db.all<{ n: number }>(sql`select count(*) as n from transactions`)[0]!.n,
    ).toBe(0);
    closeDb(db);
  });
});
