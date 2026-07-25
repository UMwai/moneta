/**
 * CSV import — the zero-key path from ADR 0003. Every bank writes a different CSV,
 * so this is deliberately tolerant: it sniffs the delimiter, maps headers by alias,
 * accepts single-amount or debit/credit-pair layouts, and works out whether dates are
 * day-first or month-first by looking at the whole file rather than one row.
 *
 * Money never touches a float: values are parsed as strings straight into minor units.
 */

import { createHash } from "node:crypto";

import type { ProviderTransaction } from "@/lib/types";
import { decimalStringToMinor, parseDecimalString } from "@/lib/providers/money";

export class CsvImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvImportError";
  }
}

// ---------- raw parser ----------

const QUOTE = '"';
const DELIMITER_CANDIDATES = [",", ";", "\t", "|"] as const;

/**
 * RFC-4180-ish reader: handles quoted fields containing the delimiter, escaped `""`
 * quotes, embedded newlines, CRLF/CR/LF line endings and a leading BOM.
 */
export function parseCsv(text: string, delimiter = ","): string[][] {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldWasQuoted = false;

  const endField = () => {
    row.push(fieldWasQuoted ? field : field.trim());
    field = "";
    fieldWasQuoted = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inQuotes) {
      if (char === QUOTE) {
        if (input[i + 1] === QUOTE) {
          field += QUOTE;
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === QUOTE && field.trim() === "") {
      inQuotes = true;
      fieldWasQuoted = true;
      field = "";
      continue;
    }
    if (char === delimiter) {
      endField();
      continue;
    }
    if (char === "\n") {
      endRow();
      continue;
    }
    if (char === "\r") {
      if (input[i + 1] === "\n") i += 1;
      endRow();
      continue;
    }
    field += char;
  }

  // A file ending in a newline must not produce a trailing empty row.
  if (field !== "" || fieldWasQuoted || row.length > 0) endRow();

  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Pick the delimiter that splits the header line into the most fields. */
export function sniffDelimiter(text: string): string {
  const firstLine = firstNonEmptyLine(text);
  if (!firstLine) return ",";
  let best = ",";
  let bestCount = 0;
  for (const candidate of DELIMITER_CANDIDATES) {
    const count = countOutsideQuotes(firstLine, candidate);
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

function firstNonEmptyLine(text: string): string | null {
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line.trim() !== "") return line;
  }
  return null;
}

function countOutsideQuotes(line: string, char: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === QUOTE) {
      if (inQuotes && line[i + 1] === QUOTE) i += 1;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && c === char) {
      count += 1;
    }
  }
  return count;
}

// ---------- header mapping ----------

export type CsvField =
  | "date"
  | "name"
  | "amount"
  | "debit"
  | "credit"
  | "category"
  | "currency"
  | "account"
  | "externalId"
  | "memo"
  | "pending";

const HEADER_ALIASES: Record<CsvField, string[]> = {
  date: [
    "date",
    "transactiondate",
    "posteddate",
    "postingdate",
    "postdate",
    "posted",
    "bookingdate",
    "valuedate",
    "datposted",
    "completiondate",
    "dateposted",
  ],
  name: [
    "description",
    "name",
    "payee",
    "merchant",
    "details",
    "narrative",
    "transactiondescription",
    "originaldescription",
    "reference",
    "particulars",
  ],
  amount: ["amount", "transactionamount", "value", "amountusd", "netamount", "amt"],
  debit: ["debit", "debitamount", "withdrawal", "withdrawals", "withdrawalamount", "moneyout", "paidout", "outflow", "spend"],
  credit: ["credit", "creditamount", "deposit", "deposits", "depositamount", "moneyin", "paidin", "inflow"],
  category: ["category", "categoryname", "type", "transactiontype", "classification"],
  currency: ["currency", "currencycode", "curr", "isocurrencycode"],
  account: ["account", "accountname", "accountnumber", "accountid", "accountmask"],
  externalId: ["transactionid", "id", "fitid", "referencenumber", "uniqueid", "txnid"],
  memo: ["memo", "notes", "note", "comment", "additionalinfo"],
  pending: ["pending", "status", "cleared"],
};

/** Header text -> comparison key: lowercase, alphanumerics only. */
export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export type CsvMapping = Partial<Record<CsvField, number>>;

export function mapHeaders(headers: string[], overrides: Partial<Record<CsvField, string>> = {}): CsvMapping {
  const normalized = headers.map(normalizeHeader);
  const mapping: CsvMapping = {};
  const taken = new Set<number>();

  const claim = (field: CsvField, index: number) => {
    if (index < 0 || taken.has(index)) return false;
    mapping[field] = index;
    taken.add(index);
    return true;
  };

  for (const [field, header] of Object.entries(overrides) as Array<[CsvField, string | undefined]>) {
    if (!header) continue;
    const index = normalized.indexOf(normalizeHeader(header));
    if (index === -1) {
      throw new CsvImportError(`Column "${header}" mapped to "${field}" is not present in the file.`);
    }
    claim(field, index);
  }

  // Exact alias matches win over substring matches so "amount" never loses to
  // "amountincurrency" and "date" never loses to "datemodified".
  for (const pass of ["exact", "loose"] as const) {
    for (const field of Object.keys(HEADER_ALIASES) as CsvField[]) {
      if (mapping[field] !== undefined) continue;
      const aliases = HEADER_ALIASES[field];
      const index = normalized.findIndex((header, i) =>
        !taken.has(i) &&
        (pass === "exact"
          ? aliases.includes(header)
          : aliases.some((alias) => alias.length >= 4 && header.includes(alias))),
      );
      claim(field, index);
    }
  }

  return mapping;
}

// ---------- dates ----------

export type CsvDateFormat = "auto" | "iso" | "us" | "eu";
export type ResolvedDateFormat = Exclude<CsvDateFormat, "auto">;

const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

interface DateParts {
  a: number;
  b: number;
  year: number;
  /** true when the field carried a month name, so ordering is unambiguous */
  resolved?: { month: number; day: number };
}

function splitDate(raw: string): DateParts | null {
  const value = raw.trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?(\s*[AaPp][Mm])?$/, "").trim();
  if (!value) return null;

  // ISO / YYYY-MM-DD (also YYYY/MM/DD)
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(value);
  if (iso) {
    return { a: 0, b: 0, year: Number(iso[1]), resolved: { month: Number(iso[2]), day: Number(iso[3]) } };
  }

  // Compact YYYYMMDD
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (compact) {
    return { a: 0, b: 0, year: Number(compact[1]), resolved: { month: Number(compact[2]), day: Number(compact[3]) } };
  }

  // 5 Jan 2024 / Jan 5, 2024 / 05-JAN-2024
  const nameFirst = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})$/.exec(value);
  if (nameFirst) {
    const month = MONTH_NAMES[nameFirst[1].slice(0, 3).toLowerCase()];
    if (month) return { a: 0, b: 0, year: expandYear(Number(nameFirst[3])), resolved: { month, day: Number(nameFirst[2]) } };
  }
  const dayFirst = /^(\d{1,2})[\s-]([A-Za-z]{3,9})\.?[\s-](\d{2,4})$/.exec(value);
  if (dayFirst) {
    const month = MONTH_NAMES[dayFirst[2].slice(0, 3).toLowerCase()];
    if (month) return { a: 0, b: 0, year: expandYear(Number(dayFirst[3])), resolved: { month, day: Number(dayFirst[1]) } };
  }

  // Ambiguous numeric: a/b/year
  const numeric = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/.exec(value);
  if (numeric) {
    return { a: Number(numeric[1]), b: Number(numeric[2]), year: expandYear(Number(numeric[3])) };
  }

  return null;
}

function expandYear(year: number): number {
  if (year >= 100) return year;
  return year <= 69 ? 2000 + year : 1900 + year;
}

/**
 * Decide day-first vs month-first from every date in the file: a value above 12 in
 * either position settles it. Ties fall back to month-first (US), matching the bulk
 * of consumer exports.
 */
export function detectDateFormat(values: string[]): ResolvedDateFormat {
  let sawNumeric = false;
  let dayFirstEvidence = 0;
  let monthFirstEvidence = 0;

  for (const value of values) {
    const parts = splitDate(value);
    if (!parts || parts.resolved) continue;
    sawNumeric = true;
    if (parts.a > 12) dayFirstEvidence += 1;
    if (parts.b > 12) monthFirstEvidence += 1;
  }

  if (!sawNumeric) return "iso";
  if (dayFirstEvidence > monthFirstEvidence) return "eu";
  return "us";
}

/** Parse one cell to `YYYY-MM-DD`, or null when it is not a date at all. */
export function parseDateString(raw: string, format: ResolvedDateFormat = "us"): string | null {
  const parts = splitDate(raw);
  if (!parts) return null;

  let month: number;
  let day: number;
  if (parts.resolved) {
    ({ month, day } = parts.resolved);
  } else if (format === "eu") {
    day = parts.a;
    month = parts.b;
  } else {
    month = parts.a;
    day = parts.b;
  }

  // A month above 12 means the file disagreed with the detected order; swap rather
  // than drop the row.
  if (month > 12 && day <= 12) [month, day] = [day, month];
  if (month < 1 || month > 12 || day < 1 || day > 31 || parts.year < 1900 || parts.year > 2999) {
    return null;
  }
  return `${String(parts.year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ---------- import ----------

export interface CsvImportOptions {
  /** default `auto`: inferred from the whole file */
  dateFormat?: CsvDateFormat;
  /** overridden delimiter; sniffed when omitted */
  delimiter?: string;
  /** account these rows belong to */
  accountExternalId?: string;
  /** used when the file has no currency column */
  currency?: string;
  /** for exports where a positive number means money spent */
  invertAmounts?: boolean;
  /** force specific columns, keyed by the header text as it appears in the file */
  columns?: Partial<Record<CsvField, string>>;
}

export interface CsvRowIssue {
  /** 1-based line number as a human would count it in the file */
  row: number;
  reason: string;
}

export interface CsvImportResult {
  transactions: ProviderTransaction[];
  /** resolved field -> original header text */
  mapping: Partial<Record<CsvField, string>>;
  dateFormat: ResolvedDateFormat;
  delimiter: string;
  skipped: CsvRowIssue[];
  /**
   * `ProviderTransaction` has no category slot (frozen contract), so categories found
   * in the file are handed back separately for the caller to apply after insert.
   */
  categoryByExternalId: Record<string, string>;
}

const DEFAULT_ACCOUNT_ID = "csv-import";

export function parseCsvTransactions(text: string, options: CsvImportOptions = {}): CsvImportResult {
  const delimiter = options.delimiter ?? sniffDelimiter(text);
  const rows = parseCsv(text, delimiter);
  if (rows.length === 0) throw new CsvImportError("The file is empty.");

  const headers = rows[0];
  const mapping = mapHeaders(headers, options.columns);
  if (mapping.date === undefined) {
    throw new CsvImportError(
      `Could not find a date column. Headers seen: ${headers.filter(Boolean).join(", ") || "(none)"}.`,
    );
  }
  const hasAmount = mapping.amount !== undefined;
  const hasPair = mapping.debit !== undefined || mapping.credit !== undefined;
  if (!hasAmount && !hasPair) {
    throw new CsvImportError(
      `Could not find an amount column (or a debit/credit pair). Headers seen: ${headers.filter(Boolean).join(", ") || "(none)"}.`,
    );
  }

  const body = rows.slice(1);
  const dateFormat =
    options.dateFormat && options.dateFormat !== "auto"
      ? options.dateFormat
      : detectDateFormat(body.map((row) => cell(row, mapping.date)));

  const defaultCurrency = options.currency ?? "USD";
  const accountFallback = options.accountExternalId ?? DEFAULT_ACCOUNT_ID;
  const sign = options.invertAmounts ? -1 : 1;

  const transactions: ProviderTransaction[] = [];
  const skipped: CsvRowIssue[] = [];
  const categoryByExternalId: Record<string, string> = {};
  const occurrences = new Map<string, number>();

  body.forEach((row, index) => {
    const lineNumber = index + 2;
    if (row.every((value) => value.trim() === "")) return;

    const rawDate = cell(row, mapping.date);
    const date = parseDateString(rawDate, dateFormat);
    if (!date) {
      skipped.push({ row: lineNumber, reason: rawDate ? `Unrecognised date "${rawDate}"` : "Missing date" });
      return;
    }

    const amount = readAmount(row, mapping);
    if (amount === null) {
      skipped.push({ row: lineNumber, reason: "Missing or unreadable amount" });
      return;
    }

    const name = readName(row, mapping) || "Transaction";
    const signedAmount = sign * amount;

    const explicitId = cell(row, mapping.externalId).trim();
    const key = `${date}|${name.toLowerCase()}|${signedAmount}`;
    const occurrence = occurrences.get(key) ?? 0;
    occurrences.set(key, occurrence + 1);
    const externalId = explicitId ? `csv:${explicitId}` : hashExternalId(key, occurrence);

    const currency = (cell(row, mapping.currency).trim() || defaultCurrency).toUpperCase();
    const accountExternalId = cell(row, mapping.account).trim() || accountFallback;

    transactions.push({
      externalId,
      accountExternalId,
      amount: signedAmount,
      currency: /^[A-Z]{3}$/.test(currency) ? currency : defaultCurrency,
      date,
      name,
      merchant: null,
      pending: readPending(cell(row, mapping.pending)),
    });

    const category = cell(row, mapping.category).trim();
    if (category) categoryByExternalId[externalId] = category;
  });

  return {
    transactions,
    mapping: describeMapping(headers, mapping),
    dateFormat,
    delimiter,
    skipped,
    categoryByExternalId,
  };
}

function cell(row: string[], index: number | undefined): string {
  if (index === undefined) return "";
  return row[index] ?? "";
}

function readAmount(row: string[], mapping: CsvMapping): number | null {
  if (mapping.amount !== undefined) {
    const direct = decimalStringToMinor(cell(row, mapping.amount));
    if (direct !== null) return direct;
  }

  // Debit/credit pair: magnitudes only, direction comes from the column.
  const debitRaw = cell(row, mapping.debit);
  const creditRaw = cell(row, mapping.credit);
  const debit = parseDecimalString(debitRaw) ? decimalStringToMinor(debitRaw) : null;
  const credit = parseDecimalString(creditRaw) ? decimalStringToMinor(creditRaw) : null;
  if (debit === null && credit === null) return null;
  return -Math.abs(debit ?? 0) + Math.abs(credit ?? 0);
}

function readName(row: string[], mapping: CsvMapping): string {
  const name = cell(row, mapping.name).trim();
  if (name) return collapseWhitespace(name);
  const memo = cell(row, mapping.memo).trim();
  return collapseWhitespace(memo);
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function readPending(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return normalized === "pending" || normalized === "true" || normalized === "yes" || normalized === "y";
}

/**
 * Stable id for rows the bank did not give one. Keyed on content plus how many
 * identical rows preceded it, so genuine duplicate charges survive dedupe and a
 * re-import of the same file produces the same ids.
 */
function hashExternalId(key: string, occurrence: number): string {
  const digest = createHash("sha256").update(`${key}|${occurrence}`, "utf8").digest("hex");
  return `csv:${digest.slice(0, 24)}`;
}

function describeMapping(headers: string[], mapping: CsvMapping): Partial<Record<CsvField, string>> {
  const described: Partial<Record<CsvField, string>> = {};
  for (const [field, index] of Object.entries(mapping) as Array<[CsvField, number]>) {
    described[field] = headers[index];
  }
  return described;
}
