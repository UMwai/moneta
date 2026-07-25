import { describe, expect, it } from "vitest";

import {
  CredentialsError,
  ProviderError,
  safeMessage,
  safeStatusMessage,
} from "@/lib/providers/errors";

const ACCESS_URL = "https://user:s3cret@bridge.example.com/simplefin";

describe("safeMessage", () => {
  it("keeps the message of errors this codebase wrote", () => {
    expect(safeMessage(new ProviderError("simplefin", "SimpleFIN returned HTTP 500."))).toBe(
      "SimpleFIN returned HTTP 500.",
    );
    expect(safeMessage(new CredentialsError("plaid", "Invalid client id."))).toBe(
      "Invalid client id.",
    );
  });

  it("replaces every other error, which may quote the request", () => {
    // undici's parse failure embeds the URL it was given — userinfo and all.
    const undici = new TypeError(`Failed to parse URL from ${ACCESS_URL}`);

    const message = safeMessage(undici, "The provider could not be reached.");
    expect(message).toBe("The provider could not be reached.");
    expect(message).not.toContain("s3cret");
    expect(safeMessage("a thrown string")).toBe("Unexpected provider error");
    expect(safeMessage(undefined)).toBe("Unexpected provider error");
  });
});

describe("safeStatusMessage", () => {
  it("redacts URLs before they can be persisted", () => {
    expect(safeStatusMessage(`Could not reach ${ACCESS_URL} — timed out`)).toBe(
      "Could not reach [redacted] — timed out",
    );
    expect(
      safeStatusMessage("claim at https://bridge.example.com/claim/abc123 failed"),
    ).toBe("claim at [redacted] failed");
  });

  it("falls back when nothing but a URL is left", () => {
    expect(safeStatusMessage(ACCESS_URL)).toBe("The provider could not be reached.");
    expect(safeStatusMessage("   ")).toBe("The provider could not be reached.");
  });

  it("clamps the length so a whole response body cannot be stored", () => {
    const clamped = safeStatusMessage("x".repeat(5_000));
    expect(clamped).toHaveLength(200);
    expect(clamped.endsWith("…")).toBe(true);
  });

  it("collapses newlines so a multi-line dump stays one status line", () => {
    expect(safeStatusMessage("line one\n\tline two")).toBe("line one line two");
  });
});
