/**
 * OFX / QFX import. Two flavours exist in the wild and banks ship both:
 *
 *   - SGML (OFX 1.x, what most US banks and Quicken export): leaf tags are unclosed,
 *     `<TRNAMT>-12.34` runs to the end of the line.
 *   - XML (OFX 2.x): well-formed, `<TRNAMT>-12.34</TRNAMT>`.
 *
 * Rather than build two parsers, the file is scanned for `<STMTTRN>` blocks and leaf
 * values are read with one tolerant pattern that stops at the next `<` or newline —
 * correct for both flavours. Real-world quirks handled: a header block before `<OFX>`,
 * `&amp;`-style entities, timestamps with timezone suffixes, CRLF, and credit-card
 * statements (`CCSTMTRS`) alongside bank ones.
 */

import type { AccountType, ProviderAccount, ProviderTransaction } from "@/lib/types";
import { decimalStringToMinor, normalizeCurrency } from "@/lib/providers/money";

export class OfxImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OfxImportError";
  }
}

export interface OfxImportOptions {
  /** used when the statement omits CURDEF */
  defaultCurrency?: string;
}

export interface OfxImportResult {
  accounts: ProviderAccount[];
  transactions: ProviderTransaction[];
  /** institution name from the `<FI>` block, when present */
  institution: string | null;
}

// ---------- low-level readers ----------

/** Matches `<TAG>value` in SGML and `<TAG>value</TAG>` in XML alike. */
const LEAF_PATTERN = /<([A-Za-z][A-Za-z0-9._]*)>([^<\r\n]*)/g;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeOfxEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity: string) => {
    if (entity.startsWith("#")) {
      const code = entity.startsWith("#x") || entity.startsWith("#X")
        ? Number.parseInt(entity.slice(2), 16)
        : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Collect every leaf tag in a fragment. Later duplicates win only if the first was blank. */
function readLeaves(fragment: string): Map<string, string> {
  const leaves = new Map<string, string>();
  LEAF_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LEAF_PATTERN.exec(fragment)) !== null) {
    const tag = match[1].toUpperCase();
    const value = decodeOfxEntities(match[2].trim());
    if (!value) continue;
    if (!leaves.has(tag)) leaves.set(tag, value);
  }
  return leaves;
}

function extractBlocks(text: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "gi");
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) blocks.push(match[1]);
  return blocks;
}

/**
 * `YYYYMMDD`, `YYYYMMDDHHMMSS`, `YYYYMMDDHHMMSS.XXX[-5:EST]` -> `YYYY-MM-DD`.
 * The timezone suffix is intentionally ignored: OFX posting dates are already the
 * institution's local posting day, and shifting them moves transactions between days.
 */
export function parseOfxDate(value: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${year}-${month}-${day}`;
}

// ---------- mapping ----------

const ACCTTYPE_MAP: Record<string, AccountType> = {
  CHECKING: "checking",
  SAVINGS: "savings",
  MONEYMRKT: "savings",
  CD: "savings",
  CREDITLINE: "loan",
};

function statementAccountType(block: string, isCreditCard: boolean): AccountType {
  if (isCreditCard) return "credit";
  const acctType = readLeaves(block).get("ACCTTYPE");
  return (acctType && ACCTTYPE_MAP[acctType.toUpperCase()]) || "checking";
}

function transactionName(leaves: Map<string, string>, payeeName: string | null): string {
  return (
    leaves.get("NAME") ||
    payeeName ||
    leaves.get("MEMO") ||
    leaves.get("TRNTYPE") ||
    "Transaction"
  );
}

// ---------- entry point ----------

export function parseOfx(text: string, options: OfxImportOptions = {}): OfxImportResult {
  if (!/<(OFX|STMTTRN|STMTRS|CCSTMTRS)\b/i.test(text)) {
    throw new OfxImportError("This does not look like an OFX/QFX file — no OFX tags found.");
  }
  const defaultCurrency = options.defaultCurrency ?? "USD";
  const body = text.slice(text.search(/<OFX>/i) >= 0 ? text.search(/<OFX>/i) : 0);
  const institution = readLeaves(extractBlocks(body, "FI")[0] ?? "").get("ORG") ?? null;

  const accounts: ProviderAccount[] = [];
  const transactions: ProviderTransaction[] = [];
  const seenAccounts = new Set<string>();

  const statements: Array<{ block: string; creditCard: boolean }> = [
    ...extractBlocks(body, "STMTRS").map((block) => ({ block, creditCard: false })),
    ...extractBlocks(body, "CCSTMTRS").map((block) => ({ block, creditCard: true })),
  ];

  // Some exports (and hand-trimmed fixtures) carry transactions with no statement
  // wrapper at all; fall back to treating the whole document as one statement.
  if (statements.length === 0) {
    statements.push({ block: body, creditCard: false });
  }

  for (const { block, creditCard } of statements) {
    const acctBlock =
      extractBlocks(block, "BANKACCTFROM")[0] ?? extractBlocks(block, "CCACCTFROM")[0] ?? "";
    const acctLeaves = readLeaves(acctBlock);
    const statementLeaves = readLeaves(block.replace(/<BANKTRANLIST>[\s\S]*?<\/BANKTRANLIST>/gi, ""));

    const accountId = acctLeaves.get("ACCTID") ?? statementLeaves.get("ACCTID") ?? "ofx-import";
    const currency = normalizeCurrency(statementLeaves.get("CURDEF"), defaultCurrency);

    if (!seenAccounts.has(accountId)) {
      seenAccounts.add(accountId);
      const ledger = readLeaves(extractBlocks(block, "LEDGERBAL")[0] ?? "").get("BALAMT");
      const available = readLeaves(extractBlocks(block, "AVAILBAL")[0] ?? "").get("BALAMT");
      const type = statementAccountType(acctBlock, creditCard);
      accounts.push({
        externalId: accountId,
        name: `${institution ?? "Imported"} ${maskOf(accountId) ?? type}`.trim(),
        officialName: null,
        type,
        currency,
        balance: ledger ? decimalStringToMinor(ledger) ?? 0 : 0,
        available: available ? decimalStringToMinor(available) : null,
        institution,
        mask: maskOf(accountId),
      });
    }

    for (const txnBlock of extractBlocks(block, "STMTTRN")) {
      const leaves = readLeaves(txnBlock);
      const posted = leaves.get("DTPOSTED") ?? leaves.get("DTUSER") ?? leaves.get("DTAVAIL");
      const date = posted ? parseOfxDate(posted) : null;
      const rawAmount = leaves.get("TRNAMT");
      const amount = rawAmount ? decimalStringToMinor(rawAmount) : null;
      if (!date || amount === null) continue;

      const payeeName = readLeaves(extractBlocks(txnBlock, "PAYEE")[0] ?? "").get("NAME") ?? null;
      const fitId = leaves.get("FITID");

      transactions.push({
        // OFX guarantees FITID uniqueness per account; only truly broken files omit it.
        externalId: fitId ? `ofx:${accountId}:${fitId}` : `ofx:${accountId}:${date}:${amount}:${transactions.length}`,
        accountExternalId: accountId,
        // OFX already signs outflow negative, matching Moneta.
        amount,
        currency: normalizeCurrency(leaves.get("CURSYM"), currency),
        date,
        name: collapse(transactionName(leaves, payeeName)),
        merchant: payeeName ? collapse(payeeName) : null,
        pending: false,
      });
    }
  }

  return { accounts, transactions, institution };
}

function collapse(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function maskOf(accountId: string): string | null {
  const digits = accountId.replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}
