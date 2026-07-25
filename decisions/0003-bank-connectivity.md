# ADR 0003 — Bank connectivity (BYO key)

**Status:** accepted

## Options

1. **Provider abstraction with multiple adapters: Plaid, SimpleFIN Bridge, Teller +
   CSV/OFX import** — user supplies their own credentials in Settings; no adapter is
   mandatory.
2. Plaid only — best coverage/docs but paid production access; individuals often can't
   get keys.
3. CSV/OFX import only — free and universal but manual; weak "connect your bank" story.

## Decision

**Option 1.** A single `BankProvider` interface (`listAccounts`, `syncTransactions`,
`getBalances`, link-flow hooks). Plaid = best UX for those with dev keys; SimpleFIN
Bridge = cheap and individual-friendly; CSV/OFX = works for everyone with zero keys.
Provider credentials live only in the user's own DB, encrypted (ADR 0005).
