import { describe, expect, it, vi } from "vitest";

import {
  assertPublicHttpsUrl,
  guardedFetch,
  isPublicAddress,
  type FetchLike,
  type LookupLike,
} from "@/lib/providers/netguard";

// Nothing here may touch DNS or the network: every lookup and fetch is injected.
const resolvesTo = (...addresses: string[]): LookupLike =>
  async () => addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

const PUBLIC = "203.0.113.10";

describe("isPublicAddress", () => {
  it.each([
    "0.0.0.0",
    "10.1.2.3",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.254",
    "192.168.1.1",
    "192.0.0.1",
    "100.64.0.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "64:ff9b::a9fe:a9fe",
    "not-an-address",
  ])("blocks %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each([
    "203.0.113.10",
    "8.8.8.8",
    "172.32.0.1",
    "100.128.0.1",
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
  ])("allows %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });
});

describe("assertPublicHttpsUrl", () => {
  it("accepts a public host over https", async () => {
    await expect(
      assertPublicHttpsUrl("https://bridge.example.com/x", "simplefin", resolvesTo(PUBLIC)),
    ).resolves.toBeUndefined();
  });

  it("refuses anything that is not https", async () => {
    const lookup = vi.fn(resolvesTo(PUBLIC));
    await expect(
      assertPublicHttpsUrl("http://bridge.example.com", "simplefin", lookup),
    ).rejects.toThrow(/https/i);
    await expect(
      assertPublicHttpsUrl("file:///etc/passwd", "simplefin", lookup),
    ).rejects.toThrow(/https/i);
    await expect(
      assertPublicHttpsUrl("not a url", "simplefin", lookup),
    ).rejects.toThrow(/valid URL/i);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("refuses a literal private address without asking DNS", async () => {
    const lookup = vi.fn(resolvesTo(PUBLIC));
    for (const host of ["https://127.0.0.1/x", "https://[::1]/x", "https://169.254.169.254/latest"]) {
      await expect(assertPublicHttpsUrl(host, "simplefin", lookup)).rejects.toMatchObject({
        code: "blocked_target",
      });
    }
    expect(lookup).not.toHaveBeenCalled();
  });

  it("refuses a host that resolves into the private space", async () => {
    await expect(
      assertPublicHttpsUrl("https://evil.example.com", "simplefin", resolvesTo("192.168.1.10")),
    ).rejects.toMatchObject({ code: "blocked_target" });
  });

  it("refuses a host whose answers are only partly public", async () => {
    // Which address `fetch` picks is not ours to decide, so one bad answer is
    // enough to reject the host.
    await expect(
      assertPublicHttpsUrl("https://mixed.example.com", "simplefin", resolvesTo(PUBLIC, "10.0.0.5")),
    ).rejects.toMatchObject({ code: "blocked_target" });
  });

  it("refuses a host with no answers, and reports a failed lookup as a network error", async () => {
    await expect(
      assertPublicHttpsUrl("https://empty.example.com", "simplefin", resolvesTo()),
    ).rejects.toMatchObject({ code: "blocked_target" });

    await expect(
      assertPublicHttpsUrl("https://nx.example.com", "simplefin", async () => {
        throw new Error("getaddrinfo ENOTFOUND nx.example.com");
      }),
    ).rejects.toMatchObject({ code: "network_error" });
  });
});

describe("guardedFetch", () => {
  it("never follows a redirect", async () => {
    const fetchImpl = vi.fn<FetchLike>(
      async () =>
        new Response("", { status: 302, headers: { location: "http://169.254.169.254/" } }),
    );

    await expect(
      guardedFetch("https://bridge.example.com/x", { method: "GET" }, {
        provider: "simplefin",
        fetch: fetchImpl,
        lookup: resolvesTo(PUBLIC),
      }),
    ).rejects.toMatchObject({ code: "blocked_redirect" });

    expect(fetchImpl.mock.calls[0][1]).toMatchObject({ redirect: "manual" });
  });

  it("passes a 2xx through with the caller's init intact", async () => {
    const fetchImpl = vi.fn<FetchLike>(async () => new Response("ok", { status: 200 }));

    const response = await guardedFetch(
      "https://bridge.example.com/x",
      { method: "POST", headers: { "Content-Length": "0" } },
      { provider: "simplefin", fetch: fetchImpl, lookup: resolvesTo(PUBLIC) },
    );

    await expect(response.text()).resolves.toBe("ok");
    expect(fetchImpl.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: { "Content-Length": "0" },
      redirect: "manual",
    });
  });

  it("does not call fetch at all for a blocked target", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok"));

    await expect(
      guardedFetch("https://internal.example.com", {}, {
        provider: "simplefin",
        fetch: fetchImpl,
        lookup: resolvesTo("10.0.0.5"),
      }),
    ).rejects.toMatchObject({ code: "blocked_target" });

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
