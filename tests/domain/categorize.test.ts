import { beforeEach, describe, expect, it } from "vitest";
import { closeDb, createTestDb, type Db } from "@/db";
import {
  applyCategory,
  autoCategorize,
  matchCategory,
  normalizeMerchantKey,
  normalizeText,
} from "@/lib/domain";
import { getTransaction, updateTransaction } from "@/lib/domain/repos";
import { insertAccount, insertTx } from "./helpers";

describe("normalization", () => {
  it("strips punctuation and case", () => {
    expect(normalizeText("SQ *Blue Bottle Coffee #42")).toBe(
      "sq blue bottle coffee 42",
    );
  });

  it("reduces a noisy descriptor to a merchant identity", () => {
    expect(
      normalizeMerchantKey({ name: "SQ *NETFLIX #4821 07/12 PPD ID:9912" }),
    ).toBe("sq netflix");
    expect(
      normalizeMerchantKey({ name: "POS DEBIT NETFLIX.COM", merchant: null }),
    ).toBe("netflix");
    expect(
      normalizeMerchantKey({ name: "whatever", merchant: "Netflix" }),
    ).toBe("netflix");
  });
});

describe("rule matching", () => {
  it.each([
    ["WHOLE FOODS MKT #123", -8_000, "cat_groceries"],
    ["STARBUCKS STORE 1234", -650, "cat_coffee"],
    ["DOORDASH*TACO PLACE", -3_200, "cat_delivery"],
    ["NETFLIX.COM", -1_599, "cat_streaming"],
    ["UBER TRIP 8A2B", -1_800, "cat_rideshare"],
    ["UBER EATS", -2_600, "cat_delivery"],
    ["SHELL OIL 5748", -5_500, "cat_gas"],
    ["CVS/PHARMACY #01234", -1_200, "cat_pharmacy"],
    ["DELTA AIR LINES", -42_000, "cat_flights"],
    ["AMZN Mktp US*2X4T", -3_499, "cat_general_merch"],
    ["INTEREST CHARGE ON PURCHASES", -2_100, "cat_interest_charge"],
    ["PAYMENT THANK YOU - MOBILE", 50_000, "cat_credit_card_payment"],
  ])("categorizes %s", (name, amount, expected) => {
    expect(matchCategory({ name, amount })).toBe(expected);
  });

  it("uses direction to tell income from spending", () => {
    expect(matchCategory({ name: "ACME PAYROLL DIRECT DEP", amount: 300_000 })).toBe(
      "cat_salary",
    );
    expect(matchCategory({ name: "ACME PAYROLL DIRECT DEP", amount: -300_000 })).not.toBe(
      "cat_salary",
    );
  });

  it("returns null when nothing matches", () => {
    expect(matchCategory({ name: "ZQX HOLDINGS 44821", amount: -1_000 })).toBeNull();
  });
});

describe("auto-categorization", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
    return () => closeDb(db);
  });

  it("fills in uncategorized rows and reports what it could not match", () => {
    const account = insertAccount(db);
    const known = insertTx(db, account.id, { name: "TRADER JOE'S #455" });
    const unknown = insertTx(db, account.id, { name: "ZQX HOLDINGS 44821" });

    const result = autoCategorize(db);
    expect(result.scanned).toBe(2);
    expect(result.categorized).toBe(1);
    expect(result.unmatched).toBe(1);
    expect(getTransaction(db, known.id)!.categoryId).toBe("cat_groceries");
    expect(getTransaction(db, unknown.id)!.categoryId).toBeNull();
  });

  it("never re-categorizes a transaction a user set by hand", () => {
    const account = insertAccount(db);
    const tx = insertTx(db, account.id, { name: "TRADER JOE'S #455" });
    updateTransaction(db, tx.id, { categoryId: "cat_gifts" });

    autoCategorize(db);
    expect(getTransaction(db, tx.id)!.categoryId).toBe("cat_gifts");
    expect(applyCategory(db, tx.id, "cat_groceries")).toBe(false);
    expect(getTransaction(db, tx.id)!.categoryId).toBe("cat_gifts");
  });

  it("leaves a transaction uncategorized when the user cleared it", () => {
    const account = insertAccount(db);
    const tx = insertTx(db, account.id, { name: "TRADER JOE'S #455" });
    updateTransaction(db, tx.id, { categoryId: null });

    expect(autoCategorize(db).categorized).toBe(0);
    expect(getTransaction(db, tx.id)!.categoryId).toBeNull();
  });

  it("still lets an explicit user override through", () => {
    const account = insertAccount(db);
    const tx = insertTx(db, account.id, { name: "TRADER JOE'S #455" });
    autoCategorize(db);
    expect(applyCategory(db, tx.id, "cat_gifts", "user")).toBe(true);
    expect(getTransaction(db, tx.id)!.categoryId).toBe("cat_gifts");
  });

  it("honours a date window", () => {
    const account = insertAccount(db);
    insertTx(db, account.id, { name: "TRADER JOE'S", date: "2026-05-01" });
    insertTx(db, account.id, { name: "TRADER JOE'S", date: "2026-07-01" });
    expect(autoCategorize(db, { from: "2026-06-01" }).categorized).toBe(1);
  });
});
