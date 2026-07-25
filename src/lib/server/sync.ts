/**
 * Provider sync.
 *
 * Load a connection, decrypt its credentials, ask the adapter for everything new
 * since the stored cursor, fold the result into the ledger, then advance the
 * cursor. Accounts are matched on `externalId` and transactions on
 * `(accountId, externalId)`, so a sync that overlaps the previous one updates
 * rows instead of duplicating them.
 *
 * Credentials exist as plaintext only inside `runSync`, are passed straight to
 * the adapter, and are never logged, stored, or attached to an error.
 */

import type { Db } from "@/db";
import {
  createAccount,
  findAccountByExternalId,
  listAccounts,
  upsertProviderAccount,
} from "@/lib/domain/repos/accounts";
import {
  getConnection,
  getCredentialsEnc,
  getSyncCursor,
  markSynced,
  setStatus,
} from "@/lib/domain/repos/connections";
import {
  deleteTransactionsByExternalIds,
  upsertProviderTransaction,
} from "@/lib/domain/repos/transactions";
import { CredentialsError, safeMessage } from "@/lib/providers/errors";
import { runPostProcessing } from "@/lib/server/pipeline";
import { resolveProvider } from "@/lib/server/providers";
import { decryptCredentials } from "@/lib/server/secrets";
import type { Connection, SyncResult } from "@/lib/types";

export interface SyncOutcome {
  added: number;
  modified: number;
}

export class ConnectionNotFoundError extends Error {
  constructor() {
    super("Connection not found");
    this.name = "ConnectionNotFoundError";
  }
}

/** A sync that failed on the provider's side; the message is user-safe. */
export class SyncFailedError extends Error {
  constructor(
    message: string,
    readonly status: Connection["status"],
  ) {
    super(message);
    this.name = "SyncFailedError";
  }
}

/**
 * A transaction can reference an account the adapter did not include in this
 * page. Materialising a stub keeps the row rather than dropping it; the next
 * sync that does report the account upgrades the stub in place.
 */
function accountResolver(
  db: Db,
  connectionId: string,
  result: SyncResult,
): (externalId: string) => string {
  const cache = new Map<string, string>();
  for (const account of result.accounts) {
    cache.set(
      account.externalId,
      upsertProviderAccount(db, connectionId, account).id,
    );
  }

  return (externalId: string) => {
    const cached = cache.get(externalId);
    if (cached) return cached;

    const existing = findAccountByExternalId(db, connectionId, externalId);
    const id =
      existing?.id ??
      createAccount(db, {
        name: externalId,
        type: "other",
        connectionId,
        externalId,
      }).id;
    cache.set(externalId, id);
    return id;
  };
}

export async function syncConnection(
  db: Db,
  connectionId: string,
  opts: { today?: string } = {},
): Promise<SyncOutcome> {
  const connection = getConnection(db, connectionId);
  if (!connection) throw new ConnectionNotFoundError();

  const provider = resolveProvider(connection.provider);
  const sealed = getCredentialsEnc(db, connectionId);
  const credentials = sealed ? decryptCredentials(sealed) : null;
  const cursor = getSyncCursor(db, connectionId);

  let result: SyncResult;
  try {
    result = await provider.sync(credentials, cursor);
  } catch (error) {
    const status =
      error instanceof CredentialsError ? "reauth_required" : "error";
    const message = safeMessage(error, "The provider could not be reached.");
    setStatus(db, connectionId, status, message);
    throw new SyncFailedError(message, status);
  }

  const resolveAccount = accountResolver(db, connectionId, result);
  let added = 0;
  let modified = 0;

  db.transaction(() => {
    // `added` and `modified` are the provider's view of its own feed; what
    // counts here is whether the row was new to *us*, which is what makes a
    // re-sync of an overlapping window report nothing added.
    for (const row of [...result.added, ...result.modified]) {
      const { created } = upsertProviderTransaction(
        db,
        resolveAccount(row.accountExternalId),
        row,
      );
      if (created) added += 1;
      else modified += 1;
    }

    // Deletions are reported as bare external ids, so they have to be applied
    // across every account this connection owns.
    if (result.removedExternalIds.length > 0) {
      const owned = listAccounts(db, { includeArchived: true, connectionId });
      for (const account of owned) {
        deleteTransactionsByExternalIds(
          db,
          account.id,
          result.removedExternalIds,
        );
      }
    }
  });

  markSynced(db, connectionId, result.nextCursor);
  runPostProcessing(db, opts);

  return { added, modified };
}
