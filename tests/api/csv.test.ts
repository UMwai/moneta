import { describe, expect, it } from "vitest";

import {
  CsvParseError,
  parseTransactionCsv,
} from "@/lib/server/csv";

describe("parseTransactionCsv", () => {
  it("parses quoted fields and converts dollars to minor units exactly", () => {
    const rows = parseTransactionCsv(
      [
        "date,name,amount,category",
        '2026-07-01,"Coffee, beans",-12.30,Dining',
        '2026-07-02,"Quoted ""name""",1000,Income',
      ].join("\n"),
    );

    expect(rows).toEqual([
      {
        date: "2026-07-01",
        name: "Coffee, beans",
        amount: -1230,
        category: "Dining",
      },
      {
        date: "2026-07-02",
        name: 'Quoted "name"',
        amount: 100000,
        category: "Income",
      },
    ]);
  });

  it("supports the required three-column form", () => {
    expect(
      parseTransactionCsv("date,name,amount\r\n2026-07-03,Refund,0.05\r\n"),
    ).toEqual([
      {
        date: "2026-07-03",
        name: "Refund",
        amount: 5,
        category: null,
      },
    ]);
  });

  it("rejects malformed headers and dollar amounts", () => {
    expect(() => parseTransactionCsv("name,date,amount")).toThrow(
      CsvParseError,
    );
    expect(() =>
      parseTransactionCsv("date,name,amount\n2026-07-03,Coffee,1.234"),
    ).toThrow("Invalid dollar amount");
  });
});
