import { isIP } from "node:net";

/**
 * Rate-limit key for the caller's network address.
 *
 * Next fills `x-forwarded-for` from the connection socket, but only when the
 * client did not send one itself (`req.headers['x-forwarded-for'] ??=
 * socket.remoteAddress`, next/dist/server/base-server.js). A route handler
 * therefore cannot tell an injected value from a spoofed one, and `NextRequest`
 * has exposed no `ip` since Next 15 — so the header is only believed when the
 * operator asserts there is a proxy in front that rewrites it.
 *
 * Without that assertion the address is unknowable and every caller shares one
 * key: the login budget degrades to a global one rather than to a budget an
 * attacker can reset by rotating a header. Set `TRUST_PROXY=1` only when Moneta
 * is reachable exclusively through a reverse proxy you control.
 */
const SHARED_UNTRUSTED_KEY = "untrusted";
const MAX_KEY_LENGTH = 64;

export function trustProxyEnabled(): boolean {
  return process.env.TRUST_PROXY === "1";
}

export function clientAddressKey(request: Request): string {
  if (!trustProxyEnabled()) return SHARED_UNTRUSTED_KEY;

  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0];
  const address = normalize(forwarded ?? request.headers.get("x-real-ip"));
  return address ?? SHARED_UNTRUSTED_KEY;
}

function normalize(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return null;

  // `[::1]:443` and `1.2.3.4:443` both name one client; the port must not turn
  // one caller into an unlimited supply of keys.
  const bracketed = /^\[(.+)\](?::\d+)?$/.exec(trimmed);
  if (bracketed) return bracketed[1].slice(0, MAX_KEY_LENGTH);

  const withoutPort = trimmed.replace(/:\d+$/, "");
  if (isIP(withoutPort) && !isIP(trimmed)) return withoutPort;

  return trimmed.slice(0, MAX_KEY_LENGTH);
}
