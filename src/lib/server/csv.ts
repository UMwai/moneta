import { z } from "zod";

export interface CsvTransaction {
  date: string;
  name: string;
  amount: number;
  category: string | null;
}

export class CsvParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvParseError";
  }
}

const isoDateSchema = z.iso.date();

function parseRows(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '"') {
      if (quoted && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && input[index + 1] === "\n") {
        index += 1;
      }
      row.push(field);
      if (row.some((value) => value.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) {
    throw new CsvParseError("CSV contains an unterminated quoted field");
  }

  row.push(field);
  if (row.some((value) => value.trim() !== "")) {
    rows.push(row);
  }
  return rows;
}

function dollarsToMinorUnits(value: string): number {
  const normalized = value.trim().replace(/^\$/, "");
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) {
    throw new CsvParseError(`Invalid dollar amount: ${value}`);
  }
  const amount =
    Number.parseInt(match[2], 10) * 100 +
    Number.parseInt((match[3] ?? "").padEnd(2, "0") || "0", 10);
  const signed = match[1] === "-" ? -amount : amount;
  if (!Number.isSafeInteger(signed)) {
    throw new CsvParseError(`Dollar amount is too large: ${value}`);
  }
  return signed;
}

export function parseTransactionCsv(input: string): CsvTransaction[] {
  const rows = parseRows(input.replace(/^\uFEFF/, ""));
  if (rows.length === 0) {
    throw new CsvParseError("CSV is empty");
  }

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const required = ["date", "name", "amount"];
  if (
    !required.every((header, index) => headers[index] === header) ||
    (headers.length !== 3 &&
      !(headers.length === 4 && headers[3] === "category"))
  ) {
    throw new CsvParseError(
      "CSV header must be date,name,amount or date,name,amount,category",
    );
  }

  return rows.slice(1).map((values, index) => {
    if (values.length !== headers.length) {
      throw new CsvParseError(`CSV row ${index + 2} has the wrong column count`);
    }
    const date = values[0].trim();
    const name = values[1].trim();
    if (!isoDateSchema.safeParse(date).success) {
      throw new CsvParseError(`CSV row ${index + 2} has an invalid date`);
    }
    if (!name) {
      throw new CsvParseError(`CSV row ${index + 2} has an empty name`);
    }
    return {
      date,
      name,
      amount: dollarsToMinorUnits(values[2]),
      category: headers.length === 4 ? values[3].trim() || null : null,
    };
  });
}
