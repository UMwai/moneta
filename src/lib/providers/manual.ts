/**
 * The `manual` provider backs accounts the user maintains by hand or fills from
 * CSV/OFX imports. It owns no credentials and never talks to the network, so every
 * call is a no-op that keeps the sync pipeline uniform.
 */

import type { BankProvider, SyncResult } from "@/lib/types";

export const MANUAL_OK_MESSAGE = "Manual accounts need no credentials.";

export function createManualProvider(): BankProvider {
  return {
    kind: "manual",

    async test() {
      return { ok: true, message: MANUAL_OK_MESSAGE };
    },

    async listAccounts() {
      return [];
    },

    async sync(_credentials, cursor): Promise<SyncResult> {
      void _credentials;
      return {
        accounts: [],
        added: [],
        modified: [],
        removedExternalIds: [],
        nextCursor: cursor,
      };
    },
  };
}

export const manualProvider: BankProvider = createManualProvider();
