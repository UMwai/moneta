# ADR 0001 — Application stack

**Status:** accepted

## Options

1. **Next.js 16 full-stack (TS, App Router)** — one process, one Docker image, API routes
   + UI colocated, huge ecosystem. Con: server components learning curve.
2. FastAPI + React SPA — clean split, Python ecosystem. Con: two builds, two processes,
   heavier self-host story.
3. SvelteKit — light and fast. Con: smaller ecosystem for finance/auth libs, fewer
   contributors familiar with it.

## Decision

**Option 1.** Self-hosters get a single container with `output: "standalone"`; one
toolchain keeps CI simple and free-tier friendly.
