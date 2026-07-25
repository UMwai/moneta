/**
 * Indirection over the provider registry.
 *
 * Production always resolves through `@/lib/providers/registry`. The setter is a
 * test seam: integration tests install a fake `BankProvider` so the sync pipeline
 * can be exercised end-to-end without a network or real bank credentials.
 */

import { getProvider } from "@/lib/providers/registry";
import type { BankProvider, ProviderKind } from "@/lib/types";

export type ProviderResolver = (kind: ProviderKind) => BankProvider;

let resolver: ProviderResolver = getProvider;

export function resolveProvider(kind: ProviderKind): BankProvider {
  return resolver(kind);
}

/** Swap the adapter table; pass `null` to restore the real registry. */
export function setProviderResolver(next: ProviderResolver | null): void {
  resolver = next ?? getProvider;
}
