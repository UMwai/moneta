import { eq, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { id } from "@/db/id";
import { users } from "@/db/schema";
import { nowISO } from "@/lib/domain/dates";
import type { SessionUser } from "@/lib/types";

export interface UserRecord extends SessionUser {
  passwordHash: string;
  sessionVersion: number;
  createdAt: string;
}

export function createUser(
  db: Db,
  input: { username: string; passwordHash: string },
): UserRecord {
  const row = {
    id: id("usr"),
    username: input.username.trim().toLowerCase(),
    passwordHash: input.passwordHash,
    sessionVersion: 1,
    createdAt: nowISO(),
  };
  db.insert(users).values(row).run();
  return row;
}

export function findUserByUsername(
  db: Db,
  username: string,
): UserRecord | null {
  const row = db
    .select()
    .from(users)
    .where(eq(users.username, username.trim().toLowerCase()))
    .get();
  return row ?? null;
}

export function findUserById(db: Db, userId: string): UserRecord | null {
  return db.select().from(users).where(eq(users.id, userId)).get() ?? null;
}

export function countUsers(db: Db): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(users)
    .get();
  return row?.n ?? 0;
}

/** True before first-run setup has created the single household user. */
export function needsSetup(db: Db): boolean {
  return countUsers(db) === 0;
}

export function getSessionVersion(db: Db, userId: string): number | null {
  const row = db
    .select({ version: users.sessionVersion })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return row?.version ?? null;
}

/** Invalidates every session already issued to this user. */
export function bumpSessionVersion(db: Db, userId: string): void {
  db.update(users)
    .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, userId))
    .run();
}

/** A new password revokes the old sessions; that is the point of changing it. */
export function updatePassword(
  db: Db,
  userId: string,
  passwordHash: string,
): void {
  db.update(users)
    .set({ passwordHash, sessionVersion: sql`${users.sessionVersion} + 1` })
    .where(eq(users.id, userId))
    .run();
}

export function toSessionUser(u: UserRecord): SessionUser {
  return { id: u.id, username: u.username };
}
