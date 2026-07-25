import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DecryptionError,
  EncryptionKeyError,
  generateEncryptionKey,
  isSealed,
  open,
  openJson,
  resolveKey,
  seal,
  sealJson,
  secretsEqual,
} from "@/lib/crypto";

const KEY_A = "0".repeat(63) + "1";
const KEY_B = "f".repeat(64);

describe("crypto (ADR 0005)", () => {
  const originalKey = process.env.APP_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = KEY_A;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.APP_ENCRYPTION_KEY;
    else process.env.APP_ENCRYPTION_KEY = originalKey;
  });

  describe("key handling", () => {
    it("rejects a missing key with an actionable message", () => {
      delete process.env.APP_ENCRYPTION_KEY;
      expect(() => resolveKey()).toThrow(EncryptionKeyError);
      expect(() => resolveKey()).toThrow(/APP_ENCRYPTION_KEY is not set/);
    });

    it("rejects an empty key", () => {
      process.env.APP_ENCRYPTION_KEY = "   ";
      expect(() => resolveKey()).toThrow(EncryptionKeyError);
    });

    it("rejects a non-hex key", () => {
      process.env.APP_ENCRYPTION_KEY = "z".repeat(64);
      expect(() => resolveKey()).toThrow(/hexadecimal/);
    });

    it("rejects a key of the wrong length", () => {
      process.env.APP_ENCRYPTION_KEY = "abcdef";
      expect(() => resolveKey()).toThrow(/64 hex characters/);
    });

    it("generates keys that are directly usable", () => {
      const key = generateEncryptionKey();
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(open(seal("hello", key), key)).toBe("hello");
    });
  });

  describe("round trip", () => {
    it("seals and opens UTF-8 text", () => {
      const secret = "access-sandbox-9f8e7d — ünïcode ✅";
      expect(open(seal(secret))).toBe(secret);
    });

    it("seals and opens an empty string", () => {
      expect(open(seal(""))).toBe("");
    });

    it("produces a fresh IV per seal so identical plaintexts differ", () => {
      const a = seal("same");
      const b = seal("same");
      expect(a).not.toBe(b);
      expect(a.split(":")[1]).not.toBe(b.split(":")[1]);
      expect(open(a)).toBe(open(b));
    });

    it("emits the documented v1:iv:ciphertext:tag envelope", () => {
      const parts = seal("payload").split(":");
      expect(parts).toHaveLength(4);
      expect(parts[0]).toBe("v1");
      expect(Buffer.from(parts[1], "base64")).toHaveLength(12);
      expect(Buffer.from(parts[3], "base64")).toHaveLength(16);
      expect(isSealed(seal("payload"))).toBe(true);
      expect(isSealed("plain text")).toBe(false);
    });

    it("round-trips credential blobs as JSON", () => {
      const credentials = { clientId: "abc", secret: "shh", env: "sandbox", nested: { n: 1 } };
      const opened = openJson<typeof credentials>(sealJson(credentials));
      expect(opened).toEqual(credentials);
    });
  });

  describe("tamper detection", () => {
    it("rejects a flipped ciphertext byte", () => {
      const parts = seal("transfer 100").split(":");
      parts[2] = flipBase64(parts[2]);
      expect(() => open(parts.join(":"))).toThrow(DecryptionError);
    });

    it("rejects a flipped auth tag", () => {
      const parts = seal("transfer 100").split(":");
      parts[3] = flipBase64(parts[3]);
      expect(() => open(parts.join(":"))).toThrow(DecryptionError);
    });

    it("rejects a swapped IV", () => {
      const parts = seal("transfer 100").split(":");
      parts[1] = seal("something else").split(":")[1];
      expect(() => open(parts.join(":"))).toThrow(DecryptionError);
    });

    it("rejects a version downgrade", () => {
      const sealed = seal("transfer 100").replace(/^v1:/, "v2:");
      expect(() => open(sealed)).toThrow(/Unsupported sealed value version/);
    });

    it("rejects malformed envelopes", () => {
      expect(() => open("not-sealed-at-all")).toThrow(/4 colon-delimited segments/);
      expect(() => open("v1:AAAA:BBBB:CCCC")).toThrow(DecryptionError);
    });

    it("never leaks the plaintext or key in the error message", () => {
      const parts = seal("super-secret-token").split(":");
      parts[3] = flipBase64(parts[3]);
      try {
        open(parts.join(":"));
        expect.unreachable("open should have thrown");
      } catch (err) {
        const message = (err as Error).message;
        expect(message).not.toContain("super-secret-token");
        expect(message).not.toContain(KEY_A);
      }
    });
  });

  describe("wrong key", () => {
    it("fails to open a payload sealed under another key", () => {
      const sealed = seal("token", KEY_A);
      expect(() => open(sealed, KEY_B)).toThrow(DecryptionError);
      expect(() => open(sealed, KEY_B)).toThrow(/different APP_ENCRYPTION_KEY/);
    });

    it("opens with the explicit key even when the env var differs", () => {
      const sealed = seal("token", KEY_B);
      expect(open(sealed, KEY_B)).toBe("token");
      expect(() => open(sealed)).toThrow(DecryptionError);
    });

    it("reports non-JSON payloads distinctly from tampering", () => {
      expect(() => openJson(seal("not json"))).toThrow(/did not contain valid JSON/);
    });
  });

  it("compares secrets in constant time", () => {
    expect(secretsEqual("abc", "abc")).toBe(true);
    expect(secretsEqual("abc", "abd")).toBe(false);
    expect(secretsEqual("abc", "abcd")).toBe(false);
  });
});

/** Change one base64 character while keeping the encoding canonical. */
function flipBase64(value: string): string {
  const first = value[0] === "A" ? "B" : "A";
  return first + value.slice(1);
}
