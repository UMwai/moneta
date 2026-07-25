/**
 * Teller placeholder. Teller requires an mTLS client certificate per application,
 * which needs certificate storage the self-host setup does not have yet — see
 * ADR 0003. The adapter exists so the registry stays total over `ProviderKind` and
 * so the settings UI can show an honest "not yet" instead of a crash.
 */

import type { BankProvider, ProviderAccount, SyncResult } from "@/lib/types";
import { NotImplementedError } from "./errors";

export const TELLER_UNAVAILABLE_MESSAGE = "Teller support coming in v0.2";

export function createTellerProvider(): BankProvider {
  return {
    kind: "teller",

    async test(): Promise<{ ok: boolean; message?: string }> {
      return { ok: false, message: TELLER_UNAVAILABLE_MESSAGE };
    },

    async listAccounts(): Promise<ProviderAccount[]> {
      throw new NotImplementedError("teller", TELLER_UNAVAILABLE_MESSAGE);
    },

    async sync(): Promise<SyncResult> {
      throw new NotImplementedError("teller", TELLER_UNAVAILABLE_MESSAGE);
    },
  };
}

export const tellerProvider: BankProvider = createTellerProvider();
