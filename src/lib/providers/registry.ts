/**
 * Provider registry — the single place the rest of the app resolves a `ProviderKind`
 * to an adapter. The record type makes the mapping total: adding a kind to
 * `ProviderKind` in types.ts fails the build here until an adapter exists.
 */

import type { BankProvider, ProviderKind } from "@/lib/types";
import { manualProvider } from "./manual";
import { plaidProvider } from "./plaid";
import { simpleFinProvider } from "./simplefin";
import { tellerProvider } from "./teller";

export const PROVIDER_KINDS = ["plaid", "simplefin", "teller", "manual"] as const satisfies readonly ProviderKind[];

const REGISTRY: Record<ProviderKind, BankProvider> = {
  plaid: plaidProvider,
  simplefin: simpleFinProvider,
  teller: tellerProvider,
  manual: manualProvider,
};

export function getProvider(kind: ProviderKind): BankProvider {
  return REGISTRY[kind];
}

export function isProviderKind(value: unknown): value is ProviderKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(REGISTRY, value);
}

/** Metadata for the Settings UI: what each adapter needs from the user. */
export interface ProviderDescriptor {
  kind: ProviderKind;
  label: string;
  /** false while an adapter is a placeholder */
  available: boolean;
  /** short blurb shown next to the connect button */
  summary: string;
  credentialFields: string[];
}

export const PROVIDER_DESCRIPTORS: Record<ProviderKind, ProviderDescriptor> = {
  plaid: {
    kind: "plaid",
    label: "Plaid",
    available: true,
    summary: "Best coverage. Needs your own Plaid client id and secret.",
    credentialFields: ["clientId", "secret", "env"],
  },
  simplefin: {
    kind: "simplefin",
    label: "SimpleFIN Bridge",
    available: true,
    summary: "Low-cost and individual-friendly. Paste a setup token from your bridge.",
    credentialFields: ["setupToken"],
  },
  teller: {
    kind: "teller",
    label: "Teller",
    available: false,
    summary: "Coming in v0.2 — requires client-certificate storage.",
    credentialFields: [],
  },
  manual: {
    kind: "manual",
    label: "Manual / file import",
    available: true,
    summary: "No keys at all. Import CSV or OFX/QFX exports from your bank.",
    credentialFields: [],
  },
};

export function listProviders(): ProviderDescriptor[] {
  return PROVIDER_KINDS.map((kind) => PROVIDER_DESCRIPTORS[kind]);
}
