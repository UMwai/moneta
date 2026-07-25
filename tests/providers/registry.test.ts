import { describe, expect, it } from "vitest";

import { NotImplementedError } from "@/lib/providers/errors";
import { MANUAL_OK_MESSAGE } from "@/lib/providers/manual";
import {
  PROVIDER_DESCRIPTORS,
  PROVIDER_KINDS,
  getProvider,
  isProviderKind,
  listProviders,
} from "@/lib/providers/registry";
import { TELLER_UNAVAILABLE_MESSAGE } from "@/lib/providers/teller";
import type { ProviderKind } from "@/lib/types";

// If `ProviderKind` ever grows a member, this assignment stops compiling — which is
// the point: the registry must stay total.
const EVERY_KIND: ProviderKind[] = ["plaid", "simplefin", "teller", "manual"];

describe("provider registry", () => {
  it("resolves every ProviderKind to an adapter whose kind matches", () => {
    for (const kind of EVERY_KIND) {
      const provider = getProvider(kind);
      expect(provider.kind).toBe(kind);
      expect(typeof provider.test).toBe("function");
      expect(typeof provider.listAccounts).toBe("function");
      expect(typeof provider.sync).toBe("function");
    }
  });

  it("lists the same kinds it can resolve", () => {
    expect([...PROVIDER_KINDS].sort()).toEqual([...EVERY_KIND].sort());
    expect(listProviders().map((p) => p.kind)).toEqual([...PROVIDER_KINDS]);
    for (const kind of EVERY_KIND) {
      expect(PROVIDER_DESCRIPTORS[kind].kind).toBe(kind);
    }
  });

  it("returns the same singleton on repeat lookups", () => {
    expect(getProvider("plaid")).toBe(getProvider("plaid"));
  });

  it("narrows unknown strings", () => {
    expect(isProviderKind("plaid")).toBe(true);
    expect(isProviderKind("yodlee")).toBe(false);
    expect(isProviderKind(null)).toBe(false);
    expect(isProviderKind("toString")).toBe(false);
  });
});

describe("manual provider", () => {
  const manual = getProvider("manual");

  it("always tests ok, because it holds no credentials", async () => {
    await expect(manual.test(undefined)).resolves.toEqual({ ok: true, message: MANUAL_OK_MESSAGE });
  });

  it("syncs to nothing and preserves the caller's cursor", async () => {
    await expect(manual.listAccounts(undefined)).resolves.toEqual([]);
    await expect(manual.sync(undefined, "whatever")).resolves.toEqual({
      accounts: [],
      added: [],
      modified: [],
      removedExternalIds: [],
      nextCursor: "whatever",
    });
  });
});

describe("teller stub", () => {
  const teller = getProvider("teller");

  it("reports unavailability instead of throwing from test()", async () => {
    await expect(teller.test({})).resolves.toEqual({ ok: false, message: TELLER_UNAVAILABLE_MESSAGE });
  });

  it("throws NotImplementedError from the operations it cannot serve", async () => {
    await expect(teller.listAccounts({})).rejects.toThrow(NotImplementedError);
    await expect(teller.sync({}, null)).rejects.toMatchObject({
      code: "not_implemented",
      provider: "teller",
    });
  });
});
