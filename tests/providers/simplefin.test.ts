import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ProviderError } from "@/lib/providers/errors";
import type { LookupLike } from "@/lib/providers/netguard";
import {
  createSimpleFinProvider,
  decodeSetupToken,
  decodeSimpleFinCursor,
  encodeSimpleFinCursor,
  inferSimpleFinAccountType,
  splitAccessUrl,
  type FetchLike,
} from "@/lib/providers/simplefin";

const FIXTURE = readFileSync(new URL("./fixtures/simplefin-accounts.json", import.meta.url), "utf8");

const ACCESS_URL = "https://demo-user:demo-pass@bridge.example.com/simplefin";
const CLAIM_URL = "https://bridge.example.com/simplefin/claim/abc123";
const SETUP_TOKEN = Buffer.from(CLAIM_URL, "utf8").toString("base64");
const NOW = new Date("2024-03-20T12:00:00Z");
const NOW_SECONDS = 1710936000;

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function mockFetch(responder: (url: string) => Response): { fetch: FetchLike; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    calls.push({
      url: input,
      method: init?.method ?? "GET",
      headers: (init?.headers as Record<string, string>) ?? {},
    });
    return responder(input);
  };
  return { fetch: fetchImpl, calls };
}

function jsonResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "application/json" } });
}

/** Every hostname in this suite resolves here; the suite never touches DNS. */
const PUBLIC_ADDRESS = "203.0.113.10";
const resolvesTo =
  (...addresses: string[]): LookupLike =>
  async () =>
    addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

function providerWith(responder: (url: string) => Response, initialLookbackDays?: number) {
  const { fetch, calls } = mockFetch(responder);
  return {
    provider: createSimpleFinProvider({
      fetch,
      now: () => NOW,
      initialLookbackDays,
      lookup: resolvesTo(PUBLIC_ADDRESS),
    }),
    calls,
  };
}

describe("access URL handling", () => {
  it("moves the userinfo out of the URL and into a Basic header", () => {
    expect(splitAccessUrl(ACCESS_URL)).toEqual({
      baseUrl: "https://bridge.example.com/simplefin",
      authorization: `Basic ${Buffer.from("demo-user:demo-pass").toString("base64")}`,
    });
  });

  it("percent-decodes credentials before encoding them", () => {
    const { authorization } = splitAccessUrl("https://user%40x:p%40ss@bridge.example.com/simplefin");
    expect(authorization).toBe(`Basic ${Buffer.from("user@x:p@ss").toString("base64")}`);
  });

  it("tolerates a trailing slash and a missing userinfo", () => {
    expect(splitAccessUrl("https://bridge.example.com/simplefin/")).toEqual({
      baseUrl: "https://bridge.example.com/simplefin",
      authorization: null,
    });
  });

  it("rejects junk", () => {
    expect(() => splitAccessUrl("not a url")).toThrow(ProviderError);
    expect(() => splitAccessUrl("ftp://bridge.example.com")).toThrow(/http/);
  });
});

describe("setup token", () => {
  it("base64-decodes to the claim URL", () => {
    expect(decodeSetupToken(SETUP_TOKEN)).toBe(CLAIM_URL);
    expect(decodeSetupToken(`${SETUP_TOKEN}\n `)).toBe(CLAIM_URL);
  });

  it("rejects a token that is not a URL", () => {
    expect(() => decodeSetupToken(Buffer.from("nope").toString("base64"))).toThrow(/claim URL/);
    expect(() => decodeSetupToken("   ")).toThrow(/empty/);
  });

  it("claims the token with a POST and returns the access URL", async () => {
    const { provider, calls } = providerWith(() => new Response(`${ACCESS_URL}\n`, { status: 200 }));
    await expect(provider.claimSetupToken(SETUP_TOKEN)).resolves.toBe(ACCESS_URL);
    expect(calls).toEqual([{ url: CLAIM_URL, method: "POST", headers: { "Content-Length": "0" } }]);
  });

  it("explains an already-claimed token", async () => {
    const { provider } = providerWith(() => new Response("", { status: 403 }));
    await expect(provider.claimSetupToken(SETUP_TOKEN)).rejects.toThrow(/already been claimed/);
  });

  it("claims transparently when only a setup token is stored", async () => {
    const { provider, calls } = providerWith((url) =>
      url === CLAIM_URL ? new Response(ACCESS_URL) : jsonResponse(FIXTURE),
    );
    const accounts = await provider.listAccounts({ setupToken: SETUP_TOKEN });
    expect(accounts).toHaveLength(2);
    expect(calls[0].method).toBe("POST");
    expect(calls[1].url).toContain("/accounts");
  });
});

describe("cursor", () => {
  it("round-trips a unix timestamp", () => {
    expect(encodeSimpleFinCursor(1710936000)).toBe("sf1:1710936000");
    expect(decodeSimpleFinCursor("sf1:1710936000")).toBe(1710936000);
  });

  it("ignores cursors it did not mint", () => {
    expect(decodeSimpleFinCursor(null)).toBeNull();
    expect(decodeSimpleFinCursor("plaid-cursor")).toBeNull();
    expect(decodeSimpleFinCursor("sf1:not-a-number")).toBeNull();
  });
});

describe("account type inference", () => {
  it.each([
    ["Everyday Checking", "checking"],
    ["High Yield Savings", "savings"],
    ["Visa Signature Card", "credit"],
    ["Home Mortgage", "loan"],
    ["Brokerage Account", "investment"],
    ["Cash Wallet", "cash"],
    ["Acme 1234", "other"],
  ])("infers %s as %s", (name, expected) => {
    expect(inferSimpleFinAccountType(name)).toBe(expected);
  });
});

describe("simplefin provider", () => {
  it("maps accounts, decimal strings and currencies", async () => {
    const { provider, calls } = providerWith(() => jsonResponse(FIXTURE));
    const accounts = await provider.listAccounts({ accessUrl: ACCESS_URL });

    expect(accounts[0]).toEqual({
      externalId: "ACT-checking-001",
      name: "Everyday Checking",
      officialName: null,
      type: "checking",
      currency: "USD",
      balance: 123456,
      available: 120000,
      institution: "My Bank",
      mask: null,
    });
    expect(accounts[1]).toMatchObject({
      externalId: "ACT-visa-002",
      type: "credit",
      balance: -45025,
      available: null,
    });
    expect(calls[0].url).toContain("balances-only=1");
    expect(calls[0].headers.Authorization).toMatch(/^Basic /);
  });

  it("maps transactions without inverting the sign", async () => {
    const { provider } = providerWith(() => jsonResponse(FIXTURE));
    const result = await provider.sync({ accessUrl: ACCESS_URL }, null);

    expect(result.added).toHaveLength(3);
    expect(result.added[0]).toEqual({
      externalId: "TXN-1",
      accountExternalId: "ACT-checking-001",
      amount: -3300,
      currency: "USD",
      date: "2024-03-14",
      name: "BLUE BOTTLE COFFEE",
      merchant: "Blue Bottle",
      pending: false,
    });
    expect(result.added[1]).toMatchObject({ externalId: "TXN-2", amount: 250000, merchant: null });
    expect(result.added[2]).toMatchObject({
      externalId: "TXN-3",
      accountExternalId: "ACT-visa-002",
      amount: -1999,
      date: "2024-03-13",
      pending: true,
    });
    expect(result.modified).toEqual([]);
    expect(result.removedExternalIds).toEqual([]);
    expect(result.accounts).toHaveLength(2);
  });

  it("derives start-date from the lookback window on a first sync", async () => {
    const { provider, calls } = providerWith(() => jsonResponse(FIXTURE), 30);
    const result = await provider.sync({ accessUrl: ACCESS_URL }, null);
    expect(calls[0].url).toContain(`start-date=${NOW_SECONDS - 30 * 86400}`);
    // Next cursor re-requests a short overlap so late-posting rows are not missed.
    expect(result.nextCursor).toBe(`sf1:${NOW_SECONDS - 3 * 86400}`);
  });

  it("derives start-date from a previous cursor", async () => {
    const { provider, calls } = providerWith(() => jsonResponse(FIXTURE));
    await provider.sync({ accessUrl: ACCESS_URL }, "sf1:1700000000");
    expect(calls[0].url).toContain("start-date=1700000000");
  });

  it("reports a healthy connection from test()", async () => {
    const { provider } = providerWith(() => jsonResponse(FIXTURE));
    await expect(provider.test({ accessUrl: ACCESS_URL })).resolves.toEqual({
      ok: true,
      message: "2 account(s) reachable.",
    });
  });

  it("passes SimpleFIN's own warnings through test()", async () => {
    const { provider } = providerWith(() =>
      jsonResponse(JSON.stringify({ errors: ["Connection to My Bank needs attention"], accounts: [] })),
    );
    const result = await provider.test({ accessUrl: ACCESS_URL });
    expect(result).toEqual({ ok: false, message: "SimpleFIN reported: Connection to My Bank needs attention" });
  });

  it("asks for re-auth on 403 without echoing the access URL", async () => {
    const { provider } = providerWith(() => new Response("", { status: 403 }));
    const result = await provider.test({ accessUrl: ACCESS_URL });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Re-claim a setup token/);
    expect(result.message).not.toContain("demo-pass");
    await expect(provider.sync({ accessUrl: ACCESS_URL }, null)).rejects.toMatchObject({
      code: "reauth_required",
    });
  });

  it("rejects non-JSON and unexpected payloads", async () => {
    const { provider: htmlProvider } = providerWith(() => new Response("<html>oops</html>"));
    await expect(htmlProvider.listAccounts({ accessUrl: ACCESS_URL })).rejects.toThrow(/not JSON/);

    const { provider: shapeProvider } = providerWith(() => jsonResponse(JSON.stringify({ accounts: "nope" })));
    await expect(shapeProvider.listAccounts({ accessUrl: ACCESS_URL })).rejects.toThrow(/unexpected payload shape/);
  });

  it("surfaces other HTTP failures with the status code", async () => {
    const { provider } = providerWith(() => new Response("", { status: 500 }));
    await expect(provider.listAccounts({ accessUrl: ACCESS_URL })).rejects.toThrow(/HTTP 500/);
  });

  it("rejects credentials with neither a setup token nor an access URL", async () => {
    const { provider, calls } = providerWith(() => jsonResponse(FIXTURE));
    const result = await provider.test({});
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/setup token or an access URL/);
    expect(calls).toHaveLength(0);
  });

  it("reports an unreachable bridge as a network error without echoing it", async () => {
    const provider = createSimpleFinProvider({
      fetch: async () => {
        throw new TypeError(`Failed to parse URL from ${ACCESS_URL}`);
      },
      lookup: resolvesTo(PUBLIC_ADDRESS),
    });
    // The whole message is replaced, so neither the password nor the host the
    // transport error quoted can reach the user or `connections.last_error`.
    await expect(provider.listAccounts({ accessUrl: ACCESS_URL })).rejects.toMatchObject({
      code: "network_error",
      message: "Could not reach the SimpleFIN bridge.",
    });
  });
});

describe("egress guard", () => {
  const fetchShouldNotRun: FetchLike = async () => {
    throw new Error("fetch must not be reached");
  };

  function guardedProvider(lookup: LookupLike, fetch: FetchLike = fetchShouldNotRun) {
    return createSimpleFinProvider({ fetch, now: () => NOW, lookup });
  }

  it("refuses an access URL that resolves onto the host network", async () => {
    const provider = guardedProvider(resolvesTo("127.0.0.1"));
    await expect(provider.listAccounts({ accessUrl: ACCESS_URL })).rejects.toMatchObject({
      code: "blocked_target",
    });
  });

  it("refuses a claim URL pointed at the cloud metadata endpoint", async () => {
    const provider = guardedProvider(resolvesTo(PUBLIC_ADDRESS));
    const token = Buffer.from("https://169.254.169.254/latest/meta-data/", "utf8").toString(
      "base64",
    );
    await expect(provider.claimSetupToken(token)).rejects.toMatchObject({
      code: "blocked_target",
    });
  });

  it("refuses a plain-http access URL outright", async () => {
    const provider = guardedProvider(resolvesTo(PUBLIC_ADDRESS));
    await expect(
      provider.listAccounts({ accessUrl: "http://user:pass@bridge.example.com/simplefin" }),
    ).rejects.toThrow(/https/i);
    expect(() => decodeSetupToken(Buffer.from("http://bridge.example.com/claim").toString("base64")))
      .toThrow(/claim URL/);
  });

  it("does not follow a redirect out of the guarded host", async () => {
    const provider = guardedProvider(
      resolvesTo(PUBLIC_ADDRESS),
      async () =>
        new Response("", { status: 302, headers: { location: "http://127.0.0.1:8080/" } }),
    );
    await expect(provider.listAccounts({ accessUrl: ACCESS_URL })).rejects.toMatchObject({
      code: "blocked_redirect",
    });
  });
});
