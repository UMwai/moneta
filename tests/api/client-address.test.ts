import { afterEach, describe, expect, it } from "vitest";

import { clientAddressKey } from "@/lib/auth/client-address";

function request(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers,
  });
}

afterEach(() => {
  delete process.env.TRUST_PROXY;
});

describe("clientAddressKey", () => {
  it("ignores forwarding headers when no proxy is declared", () => {
    // The port is published straight to the network in the shipped compose
    // file, so these headers are whatever the caller typed.
    const rotated = ["1.2.3.4", "5.6.7.8", "9.9.9.9"].map((address) =>
      clientAddressKey(request({ "x-forwarded-for": address })),
    );

    expect(new Set(rotated).size).toBe(1);
    expect(clientAddressKey(request({ "x-real-ip": "1.2.3.4" }))).toBe(
      rotated[0],
    );
    expect(clientAddressKey(request({}))).toBe(rotated[0]);
  });

  it("uses the first forwarded hop when TRUST_PROXY=1", () => {
    process.env.TRUST_PROXY = "1";

    expect(
      clientAddressKey(
        request({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" }),
      ),
    ).toBe("203.0.113.7");
    expect(clientAddressKey(request({ "x-real-ip": "203.0.113.8" }))).toBe(
      "203.0.113.8",
    );
  });

  it("strips ports so one caller cannot mint a key per connection", () => {
    process.env.TRUST_PROXY = "1";

    expect(
      clientAddressKey(request({ "x-forwarded-for": "203.0.113.7:51000" })),
    ).toBe("203.0.113.7");
    expect(
      clientAddressKey(request({ "x-forwarded-for": "[2606:4700::1]:51000" })),
    ).toBe("2606:4700::1");
    expect(
      clientAddressKey(request({ "x-forwarded-for": "2606:4700::1" })),
    ).toBe("2606:4700::1");
  });

  it("falls back to the shared key when a trusted proxy sends nothing usable", () => {
    process.env.TRUST_PROXY = "1";

    expect(clientAddressKey(request({}))).toBe(
      clientAddressKey(request({ "x-forwarded-for": "  " })),
    );
  });

  it("bounds the key length so a long header cannot bloat the map", () => {
    process.env.TRUST_PROXY = "1";

    const key = clientAddressKey(
      request({ "x-forwarded-for": "a".repeat(500) }),
    );
    expect(key.length).toBeLessThanOrEqual(64);
  });
});
