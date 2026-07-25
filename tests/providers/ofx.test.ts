import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { OfxImportError, decodeOfxEntities, parseOfx, parseOfxDate } from "@/lib/import/ofx";

const SGML = readFileSync(new URL("./fixtures/statement-sgml.ofx", import.meta.url), "utf8");
const XML = readFileSync(new URL("./fixtures/statement-xml.qfx", import.meta.url), "utf8");

describe("parseOfxDate", () => {
  it.each([
    ["20240305", "2024-03-05"],
    ["20240305120000", "2024-03-05"],
    ["20240305120000.000[-5:EST]", "2024-03-05"],
    ["20240305000000.000[0:GMT]", "2024-03-05"],
  ])("normalises %s to %s", (input, expected) => {
    expect(parseOfxDate(input)).toBe(expected);
  });

  it("rejects nonsense", () => {
    expect(parseOfxDate("2024-03-05")).toBeNull();
    expect(parseOfxDate("20241305")).toBeNull();
    expect(parseOfxDate("")).toBeNull();
  });
});

describe("decodeOfxEntities", () => {
  it("decodes named and numeric entities", () => {
    expect(decodeOfxEntities("City Water &amp; Power")).toBe("City Water & Power");
    expect(decodeOfxEntities("&lt;tag&gt; &quot;q&quot; &apos;a&apos;")).toBe(`<tag> "q" 'a'`);
    expect(decodeOfxEntities("A&#38;B &#x26;C")).toBe("A&B &C");
  });

  it("leaves unknown entities alone rather than mangling them", () => {
    expect(decodeOfxEntities("100&pounds;")).toBe("100&pounds;");
  });
});

describe("SGML (OFX 1.x) statements", () => {
  it("reads the institution and account from a Quicken-style export", () => {
    const result = parseOfx(SGML);

    expect(result.institution).toBe("Third Federal S&L");
    expect(result.accounts).toEqual([
      {
        externalId: "000000123456789",
        name: "Third Federal S&L 6789",
        officialName: null,
        type: "checking",
        currency: "USD",
        balance: 342109,
        available: 330000,
        institution: "Third Federal S&L",
        mask: "6789",
      },
    ]);
  });

  it("reads unclosed leaf tags and keeps OFX's sign convention", () => {
    const { transactions } = parseOfx(SGML);

    expect(transactions).toHaveLength(3);
    expect(transactions[0]).toEqual({
      externalId: "ofx:000000123456789:2024030200001",
      accountExternalId: "000000123456789",
      amount: -4217,
      currency: "USD",
      date: "2024-03-02",
      name: "WHOLE FOODS MKT #123",
      merchant: null,
      pending: false,
    });
    expect(transactions[1]).toMatchObject({ amount: 250000, date: "2024-03-05", name: "ACME CORP PAYROLL" });
  });

  it("prefers the PAYEE aggregate for the merchant and decodes entities", () => {
    const utility = parseOfx(SGML).transactions[2];
    expect(utility.name).toBe("City Water & Power");
    expect(utility.merchant).toBe("City Water & Power");
    // Some banks write grouped amounts even though the spec forbids it.
    expect(utility.amount).toBe(-123456);
  });

  it("parses the same file with CRLF line endings", () => {
    const crlf = parseOfx(SGML.replace(/\n/g, "\r\n"));
    expect(crlf.transactions.map((t) => t.externalId)).toEqual(
      parseOfx(SGML).transactions.map((t) => t.externalId),
    );
  });
});

describe("XML (OFX 2.x) statements", () => {
  it("reads a credit-card statement", () => {
    const result = parseOfx(XML);

    expect(result.institution).toBeNull();
    expect(result.accounts).toEqual([
      {
        externalId: "XXXXXXXXXXXX4321",
        name: "Imported 4321",
        officialName: null,
        type: "credit",
        currency: "EUR",
        balance: -103499,
        available: null,
        institution: null,
        mask: "4321",
      },
    ]);
    expect(result.transactions).toEqual([
      {
        externalId: "ofx:XXXXXXXXXXXX4321:CC-0001",
        accountExternalId: "XXXXXXXXXXXX4321",
        amount: -5999,
        currency: "EUR",
        date: "2024-02-14",
        name: "CAFE & BAR",
        merchant: null,
        pending: false,
      },
      {
        externalId: "ofx:XXXXXXXXXXXX4321:CC-0002",
        accountExternalId: "XXXXXXXXXXXX4321",
        amount: 2500,
        currency: "EUR",
        date: "2024-02-20",
        name: "REFUND",
        merchant: null,
        pending: false,
      },
    ]);
  });
});

describe("real-world quirks", () => {
  it("synthesises an id when a bank omits FITID", () => {
    const fragment = `<OFX><STMTTRN><DTPOSTED>20240110<TRNAMT>-9.99<NAME>NO ID HERE</STMTTRN></OFX>`;
    const { transactions } = parseOfx(fragment);
    expect(transactions).toHaveLength(1);
    expect(transactions[0].externalId).toBe("ofx:ofx-import:2024-01-10:-999:0");
    expect(transactions[0].accountExternalId).toBe("ofx-import");
  });

  it("skips transactions with no usable date or amount", () => {
    const fragment = `<OFX><STMTTRN><FITID>1<NAME>BROKEN</STMTTRN><STMTTRN><DTPOSTED>20240110<TRNAMT>-1.00<FITID>2</STMTTRN></OFX>`;
    expect(parseOfx(fragment).transactions.map((t) => t.externalId)).toEqual(["ofx:ofx-import:2"]);
  });

  it("falls back to TRNTYPE when neither NAME nor MEMO is present", () => {
    const fragment = `<OFX><STMTTRN><TRNTYPE>ATM<DTPOSTED>20240110<TRNAMT>-40.00<FITID>3</STMTTRN></OFX>`;
    expect(parseOfx(fragment).transactions[0].name).toBe("ATM");
  });

  it("rejects files that are not OFX at all", () => {
    expect(() => parseOfx("Date,Description,Amount\n2024-01-01,X,-1")).toThrow(OfxImportError);
  });
});
