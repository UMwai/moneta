import { describe, expect, it } from "vitest";

import { decimalStringToMinor, normalizeCurrency, numberToMinor, parseDecimalString } from "@/lib/providers/money";

describe("decimalStringToMinor", () => {
  it.each([
    ["12.34", 1234],
    ["-12.34", -1234],
    ["+12.34", 1234],
    ["(12.34)", -1234],
    ["12.30-", -1230],
    ["1,234.56", 123456],
    ["1.234,56", 123456],
    ["1 234,56", 123456],
    ["$1,234.56", 123456],
    ["USD 5.00", 500],
    ["1234", 123400],
    ["1,234", 123400],
    [".5", 50],
    ["0", 0],
    ["-0.00", 0],
    ["1,234,567.89", 123456789],
  ])("parses %s to %i minor units", (input, expected) => {
    expect(decimalStringToMinor(input)).toBe(expected);
  });

  it("rounds half away from zero beyond two decimals", () => {
    expect(decimalStringToMinor("12.345")).toBe(1235);
    expect(decimalStringToMinor("12.344")).toBe(1234);
    expect(decimalStringToMinor("-0.005")).toBe(-1);
  });

  it("resolves the ambiguous three-digit tail the en-US way", () => {
    // `1,234` groups; `1.234` divides. European files stay correct when they carry a
    // decimal part, which is the case that actually matters.
    expect(decimalStringToMinor("1,234")).toBe(123400);
    expect(decimalStringToMinor("1.234")).toBe(123);
    expect(decimalStringToMinor("1.234,56")).toBe(123456);
  });

  it("returns null for values with no digits", () => {
    expect(decimalStringToMinor("")).toBeNull();
    expect(decimalStringToMinor("   ")).toBeNull();
    expect(decimalStringToMinor("N/A")).toBeNull();
    expect(decimalStringToMinor("--")).toBeNull();
  });

  it("exposes the raw split for callers that need the sign separately", () => {
    expect(parseDecimalString("(1,234.50)")).toEqual({ sign: -1, whole: "1234", fraction: "50" });
  });
});

describe("numberToMinor", () => {
  it("converts SDK-supplied major units without float drift", () => {
    expect(numberToMinor(12.34)).toBe(1234);
    expect(numberToMinor(-12.34)).toBe(-1234);
    expect(numberToMinor(0.1 + 0.2)).toBe(30);
    expect(numberToMinor(1e-9)).toBe(0);
    expect(numberToMinor(-0)).toBe(0);
    expect(numberToMinor(19.99)).toBe(1999);
    expect(numberToMinor(Number.NaN)).toBe(0);
    expect(numberToMinor(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe("normalizeCurrency", () => {
  it("upper-cases ISO codes and falls back for anything else", () => {
    expect(normalizeCurrency("usd")).toBe("USD");
    expect(normalizeCurrency("EUR")).toBe("EUR");
    expect(normalizeCurrency(null)).toBe("USD");
    expect(normalizeCurrency("")).toBe("USD");
    expect(normalizeCurrency("https://example.com/currency/beans")).toBe("USD");
    expect(normalizeCurrency(undefined, "GBP")).toBe("GBP");
  });
});
