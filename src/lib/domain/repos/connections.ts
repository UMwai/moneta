import { desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { id } from "@/db/id";
import { connections } from "@/db/schema";
import { nowISO } from "@/lib/domain/dates";
import type { Connection, ProviderKind } from "@/lib/types";
import { toConnection } from "./mappers";

/**
 * `credentialsEnc` holds the AES-256-GCM blob produced by src/lib/crypto.ts and
 * is never mapped into the Connection contract — reading it is an explicit call.
 */

export function createConnection(
  db: Db,
  input: {
    provider: ProviderKind;
    institution?: string | null;
    credentialsEnc?: string | null;
  },
): Connection {
  const row = {
    id: id("con"),
    provider: input.provider,
    institution: input.institution ?? null,
    status: "ok" as const,
    credentialsEnc: input.credentialsEnc ?? null,
    syncCursor: null,
    lastSyncAt: null,
    lastError: null,
    createdAt: nowISO(),
  };
  db.insert(connections).values(row).run();
  return toConnection(row);
}

export function listConnections(db: Db): Connection[] {
  return db
    .select()
    .from(connections)
    .orderBy(desc(connections.createdAt))
    .all()
    .map(toConnection);
}

export function getConnection(db: Db, connectionId: string): Connection | null {
  const row = db
    .select()
    .from(connections)
    .where(eq(connections.id, connectionId))
    .get();
  return row ? toConnection(row) : null;
}

export function getCredentialsEnc(db: Db, connectionId: string): string | null {
  const row = db
    .select({ blob: connections.credentialsEnc })
    .from(connections)
    .where(eq(connections.id, connectionId))
    .get();
  return row?.blob ?? null;
}

export function setCredentialsEnc(
  db: Db,
  connectionId: string,
  credentialsEnc: string,
): void {
  db.update(connections)
    .set({ credentialsEnc })
    .where(eq(connections.id, connectionId))
    .run();
}

export function getSyncCursor(db: Db, connectionId: string): string | null {
  const row = db
    .select({ cursor: connections.syncCursor })
    .from(connections)
    .where(eq(connections.id, connectionId))
    .get();
  return row?.cursor ?? null;
}

/** Records a successful sync: advances the cursor and clears any prior error. */
export function markSynced(
  db: Db,
  connectionId: string,
  cursor: string | null,
): Connection | null {
  db.update(connections)
    .set({
      syncCursor: cursor,
      lastSyncAt: nowISO(),
      status: "ok",
      lastError: null,
    })
    .where(eq(connections.id, connectionId))
    .run();
  return getConnection(db, connectionId);
}

export function setStatus(
  db: Db,
  connectionId: string,
  status: Connection["status"],
  message?: string | null,
): Connection | null {
  db.update(connections)
    .set({ status, lastError: message ?? null })
    .where(eq(connections.id, connectionId))
    .run();
  return getConnection(db, connectionId);
}

export function updateConnection(
  db: Db,
  connectionId: string,
  patch: Partial<Pick<Connection, "institution" | "status">>,
): Connection | null {
  db.update(connections)
    .set(patch)
    .where(eq(connections.id, connectionId))
    .run();
  return getConnection(db, connectionId);
}

export function deleteConnection(db: Db, connectionId: string): void {
  db.delete(connections).where(eq(connections.id, connectionId)).run();
}
