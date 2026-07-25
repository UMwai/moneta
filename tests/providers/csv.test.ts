import { describe, expect, it } from "vitest";

import {
  CsvImportError,
  detectDateFormat,
  mapHeaders,
  parseCsv,
  parseCsvTransactions,
  parseDateString,
  sniffDelimiter,
} from "@/lib/import/csv";

// ---------- raw parser ----------

describe("parseCsv", () => {
  it("keeps delimiters and escaped quotes inside quoted fields", () => {
    const rows = parseCsv('a,"b,c","he said ""hi""",d');
    expect(rows).toEqual([["a", "b,c", 'he said "hi"', "d"]]);
  });

  it("handles CRLF, bare CR and a BOM", () => {
    expect(parseCsv("﻿a,b\r\nc,d\re,f\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ]);
  });

  it("keeps newlines that live inside a quoted field", () => {
    expect(parseCsv('a,"line1\nline2",c')).toEqual([["a", "line1\nline2", "c"]]);
  });

  it("does not invent a trailing row for a trailing newline", () => {
    expect(parseCsv("a,b\n")).toHaveLength(1);
    expect(parseCsv("a,b")).toHaveLength(1);
  });

  it("drops blank lines but keeps empty fields", () => {
    expect(parseCsv("a,b\n\nc,\n")).toEqual([
      ["a", "b"],
      ["c", ""],
    ]);
  });

  it("sniffs the delimiter from the header line", () => {
    expect(sniffDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(sniffDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(sniffDelimiter("a\tb\tc")).toBe("\t");
    expect(sniffDelimiter('"a,b";c')).toBe(";");
  });
});

// ---------- headers ----------

describe("mapHeaders", () => {
  it("matches aliases regardless of case and punctuation", () => {
    const mapping = mapHeaders(["Posted Date", "Payee", "Amount (USD)", "Category"]);
    expect(mapping).toMatchObject({ date: 0, name: 1, amount: 2, category: 3 });
  });

  it("prefers an exact alias over a substring one", () => {
    const mapping = mapHeaders(["Date Modified", "Date", "Amount"]);
    expect(mapping.date).toBe(1);
  });

  it("honours explicit overrides", () => {
    const mapping = mapHeaders(["Col A", "Col B"], { date: "Col A", amount: "Col B" });
    expect(mapping).toEqual({ date: 0, amount: 1 });
  });

  it("rejects an override naming a column that is not there", () => {
    expect(() => mapHeaders(["Col A"], { date: "Nope" })).toThrow(CsvImportError);
  });
});

// ---------- dates ----------

describe("date handling", () => {
  it.each([
    ["2024-03-05", "iso", "2024-03-05"],
    ["2024/03/05", "iso", "2024-03-05"],
    ["20240305", "iso", "2024-03-05"],
    ["03/05/2024", "us", "2024-03-05"],
    ["05/03/2024", "eu", "2024-03-05"],
    ["3-5-24", "us", "2024-03-05"],
    ["5 Mar 2024", "us", "2024-03-05"],
    ["Mar 5, 2024", "us", "2024-03-05"],
    ["05-MAR-2024", "us", "2024-03-05"],
    ["03/05/2024 14:32:00", "us", "2024-03-05"],
  ] as const)("parses %s (%s) as %s", (input, format, expected) => {
    expect(parseDateString(input, format)).toBe(expected);
  });

  it("returns null for non-dates", () => {
    expect(parseDateString("not-a-date")).toBeNull();
    expect(parseDateString("")).toBeNull();
    expect(parseDateString("13/13/2024", "us")).toBeNull();
  });

  it("swaps day and month when the row contradicts the chosen order", () => {
    expect(parseDateString("15/03/2024", "us")).toBe("2024-03-15");
  });

  it("detects day-first from a value above 12 anywhere in the file", () => {
    expect(detectDateFormat(["01/02/2024", "15/03/2024"])).toBe("eu");
    expect(detectDateFormat(["01/02/2024", "03/15/2024"])).toBe("us");
    expect(detectDateFormat(["2024-01-02"])).toBe("iso");
    expect(detectDateFormat(["01/02/2024"])).toBe("us");
  });
});

// ---------- import ----------

const US_FILE = [
  "Date,Description,Amount,Category",
  '01/05/2024,"COFFEE, LARGE",-4.50,Dining',
  '01/06/2024,"He said ""hi""",(12.30),Misc',
  "01/07/2024,REFUND,25.00,",
].join("\n");

const EU_FILE = [
  "Posted Date;Details;Debit;Credit",
  "15/03/2024;RENT;1.200,00;",
  "16/03/2024;SALARY;;2.500,00",
  "17/03/2024;ATM WITHDRAWAL;60,00;",
].join("\n");

describe("parseCsvTransactions", () => {
  it("imports a quoted US-style file", () => {
    const result = parseCsvTransactions(US_FILE);

    expect(result.dateFormat).toBe("us");
    expect(result.delimiter).toBe(",");
    expect(result.mapping).toEqual({ date: "Date", name: "Description", amount: "Amount", category: "Category" });
    expect(result.skipped).toEqual([]);

    expect(result.transactions.map((t) => [t.date, t.name, t.amount])).toEqual([
      ["2024-01-05", "COFFEE, LARGE", -450],
      ["2024-01-06", 'He said "hi"', -1230],
      ["2024-01-07", "REFUND", 2500],
    ]);
  });

  it("returns categories separately, since ProviderTransaction has no category field", () => {
    const result = parseCsvTransactions(US_FILE);
    const [coffee, quoted, refund] = result.transactions;
    expect(result.categoryByExternalId[coffee.externalId]).toBe("Dining");
    expect(result.categoryByExternalId[quoted.externalId]).toBe("Misc");
    expect(result.categoryByExternalId[refund.externalId]).toBeUndefined();
  });

  it("imports a semicolon-delimited, day-first, debit/credit file", () => {
    const result = parseCsvTransactions(EU_FILE);

    expect(result.delimiter).toBe(";");
    expect(result.dateFormat).toBe("eu");
    expect(result.transactions.map((t) => [t.date, t.name, t.amount])).toEqual([
      ["2024-03-15", "RENT", -120000],
      ["2024-03-16", "SALARY", 250000],
      ["2024-03-17", "ATM WITHDRAWAL", -6000],
    ]);
  });

  it("treats a debit column as an outflow even when it is already signed", () => {
    const result = parseCsvTransactions(
      ["Date,Description,Debit,Credit", "2024-03-15,RENT,-1200.00,", "2024-03-16,PAY,,2500.00"].join("\n"),
    );
    expect(result.transactions.map((t) => t.amount)).toEqual([-120000, 250000]);
  });

  it("gives duplicate rows distinct but reproducible ids", () => {
    const file = ["Date,Description,Amount", "2024-02-01,NETFLIX,-15.99", "2024-02-01,NETFLIX,-15.99"].join("\r\n");
    const first = parseCsvTransactions(`﻿${file}\r\n`);
    const second = parseCsvTransactions(`﻿${file}\r\n`);

    expect(first.dateFormat).toBe("iso");
    expect(first.transactions).toHaveLength(2);
    expect(first.transactions[0].externalId).not.toBe(first.transactions[1].externalId);
    expect(first.transactions.map((t) => t.externalId)).toEqual(second.transactions.map((t) => t.externalId));
    expect(first.transactions[0].externalId).toMatch(/^csv:[0-9a-f]{24}$/);
  });

  it("uses the bank's own id when the file carries one", () => {
    const result = parseCsvTransactions(
      [
        "Transaction ID,Date,Description,Amount,Currency,Account,Status",
        "T-1,2024-04-01,GROCERY,-30.00,eur,ACCT-9,pending",
      ].join("\n"),
    );
    expect(result.transactions[0]).toEqual({
      externalId: "csv:T-1",
      accountExternalId: "ACCT-9",
      amount: -3000,
      currency: "EUR",
      date: "2024-04-01",
      name: "GROCERY",
      merchant: null,
      pending: true,
    });
  });

  it("applies the account and currency defaults the caller passes", () => {
    const result = parseCsvTransactions("Date,Description,Amount\n2024-04-01,X,-1.00", {
      accountExternalId: "acct-42",
      currency: "GBP",
    });
    expect(result.transactions[0]).toMatchObject({ accountExternalId: "acct-42", currency: "GBP" });
  });

  it("inverts signs for exports where positive means money spent", () => {
    const result = parseCsvTransactions("Date,Description,Amount\n2024-04-01,X,10.00", {
      invertAmounts: true,
    });
    expect(result.transactions[0].amount).toBe(-1000);
  });

  it("honours an explicit date format over detection", () => {
    const file = "Date,Description,Amount\n01/02/2024,X,-1.00";
    expect(parseCsvTransactions(file).transactions[0].date).toBe("2024-01-02");
    expect(parseCsvTransactions(file, { dateFormat: "eu" }).transactions[0].date).toBe("2024-02-01");
  });

  it("reports unusable rows instead of dropping them silently", () => {
    const result = parseCsvTransactions(
      ["Date,Description,Amount", "2024-05-01,GOOD,-1.00", "not-a-date,BAD,-2.00", "2024-05-03,NO AMOUNT,"].join("\n"),
    );
    expect(result.transactions).toHaveLength(1);
    expect(result.skipped).toEqual([
      { row: 3, reason: 'Unrecognised date "not-a-date"' },
      { row: 4, reason: "Missing or unreadable amount" },
    ]);
  });

  it("falls back to the memo column when there is no description", () => {
    const result = parseCsvTransactions("Date,Memo,Amount\n2024-05-01,  ACH   DEBIT  ,-1.00");
    expect(result.transactions[0].name).toBe("ACH DEBIT");
  });

  it("names the transaction generically rather than leaving it blank", () => {
    const result = parseCsvTransactions("Date,Description,Amount\n2024-05-01,,-1.00");
    expect(result.transactions[0].name).toBe("Transaction");
  });

  it("refuses files it cannot map", () => {
    expect(() => parseCsvTransactions("Foo,Bar\n1,2")).toThrow(/date column/);
    expect(() => parseCsvTransactions("Date,Description\n2024-05-01,X")).toThrow(/amount column/);
    expect(() => parseCsvTransactions("")).toThrow(CsvImportError);
  });
});
