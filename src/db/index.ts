import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate as applyMigrations } from "drizzle-orm/better-sqlite3/migrator";
import { seedCategories } from "@/lib/domain/seed";
import * as schema from "./schema";

export * as schema from "./schema";
export { id } from "./id";

export type Db = BetterSQLite3Database<typeof schema> & {
  $client: Database.Database;
};

const DEFAULT_PATH = "./data/moneta.db";

function migrationsFolder(): string {
  return (
    process.env.MONETA_MIGRATIONS_DIR ??
    resolve(process.cwd(), "src/db/migrations")
  );
}

function tune(sqlite: Database.Database, file: boolean): void {
  if (file) {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("synchronous = NORMAL");
  }
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
}

export function createDb(path: string): Db {
  const file = path !== ":memory:";
  if (file) mkdirSync(dirname(resolve(path)), { recursive: true });
  const sqlite = new Database(path);
  tune(sqlite, file);
  return drizzle(sqlite, { schema });
}

let cached: Db | undefined;

/** Lazy singleton for the app process. Honors DATABASE_PATH. */
export function getDb(): Db {
  if (!cached) cached = createDb(process.env.DATABASE_PATH ?? DEFAULT_PATH);
  return cached;
}

/** Applies pending drizzle migrations, then seeds system rows. Idempotent. */
export function migrate(db: Db = getDb()): Db {
  applyMigrations(db, { migrationsFolder: migrationsFolder() });
  seedCategories(db);
  return db;
}

/** In-memory database with migrations + seed applied; for tests only. */
export function createTestDb(): Db {
  const db = createDb(":memory:");
  return migrate(db);
}

export function closeDb(db: Db): void {
  (db.$client as Database.Database).close();
}
