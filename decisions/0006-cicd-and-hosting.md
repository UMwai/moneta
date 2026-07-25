# ADR 0006 — Repo home, CI/CD, distribution

**Status:** accepted

## Options

1. **Public repo `UMwai/moneta` + GitHub Actions + GHCR image** — public repos get
   unlimited free Actions minutes and free GHCR pulls; users `docker compose up` or
   pull `ghcr.io/umwai/moneta`.
2. Private repo — burns the 2,000 free minutes/month and contradicts the open-project
   goal.
3. GitLab/other CI — no advantage; the account and audience are on GitHub.

## Decision

**Option 1.** CI gate on every PR/push: lint, typecheck, vitest, `next build`, Docker
build. `main` pushes additionally publish `ghcr.io/umwai/moneta:edge`; tags publish
semver images.
