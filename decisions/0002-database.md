# ADR 0002 — Database

**Status:** accepted

## Options

1. **SQLite (better-sqlite3) + Drizzle ORM** — zero-config, single file, trivially
   backed up, perfect for single-household scale. Con: no concurrent-writer scale-out.
2. Postgres — powerful, but forces self-hosters to run a second container and manage it.
3. Prisma ORM (either DB) — nicer studio, but heavier runtime, slower cold start,
   codegen step.

## Decision

**Option 1.** A personal finance app for one household never needs Postgres scale;
"your data is one file you can copy" is a feature. Drizzle is typesafe, light, and its
migrations are plain SQL. Postgres support can come later behind Drizzle's dialect
abstraction if demand appears.
