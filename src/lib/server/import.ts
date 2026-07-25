/**
 * File import (CSV / OFX / QFX).
 *
 * Parsing is delegated to the robust importers in src/lib/import; this module is
 * only the bridge that lands their `ProviderTransaction[]` in the ledger. Rows
 * arrive with a deterministic, content-addressed `externalId`, so re-importing
 * the same file is idempotent through the same `(accountId, externalId)` upsert
 * that provider syncs use.
 */

import type { Db } from "@/db";
import { applyCategory } from "@/lib/domain/categorize";
import {
  createAccount,
  findAccountByExternalId,
  getAccount,
} from "@/lib/domain/repos/accounts";
import { listCategories } from "@/lib/domain/repos/categories";
import { upsertProviderTransaction } from "@/lib/domain/repos/transactions";
import { CsvImportError, parseCsvTransactions } from "@/lib/import/csv";
import { OfxImportError, parseOfx } from "@/lib/import/ofx";
import { runPostProcessing } from "@/lib/server/pipeline";
import type { ProviderAccount, ProviderTransaction } from "@/lib/types";

export type ImportFormat = "csv" | "ofx";

/** The external id the CSV importer assigns when a file has no account column. */
const CSV_FALLBACK_ACCOUNT = "csv-import";
const IMPORT_ACCOUNT_NAME = "File Import";

export class ImportAccountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportAccountError";
  }
}

export interface ParsedImport {
  format: ImportFormat;
  transactions: ProviderTransaction[];
  /** account metadata the file carried (OFX only) */
  accounts: ProviderAccount[];
  /** external id -> category name as written in the file */
  categoryByExternalId: Record<string, string>;
  /** rows the parser could not read; surfaced for logging, never fatal */
  skipped: number;
  institution: string | null;
}

/**
 * OFX and QFX are the same SGML/XML dialect. Sniffing the body as well as the
 * filename means a bank export saved as `.txt` still imports correctly.
 */
export function detectImportFormat(text: string, filename?: string): ImportFormat {
  const name = filename?.toLowerCase() ?? "";
  if (name.endsWith(".ofx") || name.endsWith(".qfx")) return "ofx";
  if (name.endsWith(".csv") || name.endsWith(".tsv")) return "csv";
  const head = text.slice(0, 2048).toUpperCase();
  return head.includes("OFXHEADER") || head.includes("<OFX>") ? "ofx" : "csv";
}

export function parseImportFile(text: string, filename?: string): ParsedImport {
  if (detectImportFormat(text, filename) === "ofx") {
    const result = parseOfx(text);
    return {
      format: "ofx",
      transactions: result.transactions,
      accounts: result.accounts,
      categoryByExternalId: {},
      skipped: 0,
      institution: result.institution,
    };
  }
  const result = parseCsvTransactions(text);
  return {
    format: "csv",
    transactions: result.transactions,
    accounts: [],
    categoryByExternalId: result.categoryByExternalId,
    skipped: result.skipped.length,
    institution: null,
  };
}

/** True for the parse failures that are the user's file's fault, not ours. */
export function isImportParseError(error: unknown): boolean {
  return error instanceof CsvImportError || error instanceof OfxImportError;
}

export interface ImportBatch {
  transactions: ProviderTransaction[];
  accounts?: ProviderAccount[];
  categoryByExternalId?: Record<string, string>;
  /** when set, every row lands here regardless of the file's account column */
  accountId?: string;
}

export interface ImportOutcome {
  imported: number;
}

/**
 * Resolves each row's account, creating manual (connection-less) accounts on
 * demand so a first-time import needs no setup. Accounts are keyed on
 * `externalId` within the null connection, which is what makes a repeat import
 * reuse the account it created the first time.
 */
function accountResolver(db: Db, batch: ImportBatch): (externalId: string) => string {
  if (batch.accountId) {
    if (!getAccount(db, batch.accountId)) {
      throw new ImportAccountError("Account not found");
    }
    const fixed = batch.accountId;
    return () => fixed;
  }

  const metaByExternalId = new Map(
    (batch.accounts ?? []).map((account) => [account.externalId, account]),
  );
  const cache = new Map<string, string>();

  return (externalId: string) => {
    const cached = cache.get(externalId);
    if (cached) return cached;

    const existing = findAccountByExternalId(db, null, externalId);
    if (existing) {
      cache.set(externalId, existing.id);
      return existing.id;
    }

    const meta = metaByExternalId.get(externalId);
    const created = createAccount(db, {
      name:
        meta?.name ??
        (externalId === CSV_FALLBACK_ACCOUNT ? IMPORT_ACCOUNT_NAME : externalId),
      officialName: meta?.officialName ?? null,
      type: meta?.type ?? "checking",
      currency: meta?.currency ?? "USD",
      balance: meta?.balance ?? 0,
      available: meta?.available ?? null,
      institution: meta?.institution ?? null,
      mask: meta?.mask ?? null,
      connectionId: null,
      externalId,
    });
    cache.set(externalId, created.id);
    return created.id;
  };
}

function categoryIndex(db: Db): Map<string, string> {
  const index = new Map<string, string>();
  for (const category of listCategories(db)) {
    index.set(category.id.toLowerCase(), category.id);
    // Last writer wins on duplicate leaf names; the id lookup above still gives
    // callers an unambiguous way to target one exactly.
    index.set(category.name.toLowerCase(), category.id);
  }
  return index;
}

/**
 * Persists a parsed batch and runs the same post-processing a provider sync
 * does. Returns the number of rows that were genuinely new.
 */
export function applyImport(
  db: Db,
  batch: ImportBatch,
  opts: { today?: string } = {},
): ImportOutcome {
  const resolveAccount = accountResolver(db, batch);
  const categories = categoryIndex(db);
  const categoryByExternalId = batch.categoryByExternalId ?? {};
  let imported = 0;

  db.transaction(() => {
    for (const row of batch.transactions) {
      const accountId = resolveAccount(row.accountExternalId);
      const { transaction, created } = upsertProviderTransaction(
        db,
        accountId,
        row,
      );
      if (created) imported += 1;

      const label = categoryByExternalId[row.externalId];
      const categoryId = label ? categories.get(label.toLowerCase()) : undefined;
      if (categoryId) applyCategory(db, transaction.id, categoryId, "auto");
    }
  });

  if (batch.transactions.length > 0) runPostProcessing(db, opts);
  return { imported };
}
