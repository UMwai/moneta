/**
 * Egress guard for provider URLs that originate from user input.
 *
 * A SimpleFIN setup token decodes to a claim URL and the claim returns an access
 * URL; both are pasted by the user and then fetched by the server, which makes
 * them a server-side request forgery vector against whatever else is reachable
 * from the container — the Docker gateway, a metadata endpoint, another service
 * on the LAN. Every such fetch goes through `guardedFetch`.
 *
 * The policy is:
 *   - https only, so a downgrade cannot expose the Basic credentials in transit;
 *   - the hostname must resolve exclusively to public unicast addresses;
 *   - redirects are not followed at all (`redirect: "manual"`, 3xx is an error),
 *     which is the cheapest way to close the redirect-to-private-address hole.
 *
 * Known limitation: the DNS check and the socket that `fetch` opens are two
 * separate resolutions, so a hostile resolver could answer differently for each
 * (DNS rebinding). Closing that needs a pinned-address dispatcher, which is not
 * reachable through the standard `fetch` types; the check still stops every
 * literal and static-DNS case.
 */

import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

import { CredentialsError, ProviderError } from "./errors";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type LookupLike = (hostname: string) => Promise<ResolvedAddress[]>;

export const defaultLookup: LookupLike = (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true });

export interface GuardOptions {
  provider: string;
  fetch: FetchLike;
  lookup?: LookupLike;
}

/** Reject anything that is not a public unicast address. */
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicIPv4(parseIPv4(address));
  if (version === 6) return isPublicIPv6(address);
  return false;
}

export async function assertPublicHttpsUrl(
  rawUrl: string,
  provider: string,
  lookup: LookupLike = defaultLookup,
): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new CredentialsError(provider, "That address is not a valid URL.");
  }
  if (url.protocol !== "https:") {
    throw new CredentialsError(provider, "Only https URLs are allowed.");
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw blocked(provider);
    return;
  }

  let resolved: ResolvedAddress[];
  try {
    resolved = await lookup(hostname);
  } catch {
    throw new ProviderError(
      provider,
      "That host could not be resolved.",
      "network_error",
    );
  }
  // Every answer has to be public: a host that returns one public and one
  // private address would otherwise be a coin flip at connect time.
  if (
    resolved.length === 0 ||
    !resolved.every((entry) => isPublicAddress(entry.address))
  ) {
    throw blocked(provider);
  }
}

export async function guardedFetch(
  url: string,
  init: RequestInit,
  options: GuardOptions,
): Promise<Response> {
  await assertPublicHttpsUrl(url, options.provider, options.lookup);

  const response = await options.fetch(url, { ...init, redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    throw new ProviderError(
      options.provider,
      "That host answered with a redirect, which is not followed.",
      "blocked_redirect",
    );
  }
  return response;
}

function blocked(provider: string): ProviderError {
  return new ProviderError(
    provider,
    "That host resolves to a private or reserved address, which is not allowed.",
    "blocked_target",
  );
}

function parseIPv4(address: string): number[] {
  return address.split(".").map((part) => Number.parseInt(part, 10));
}

function isPublicIPv4([a, b]: number[]): boolean {
  if (a === 0) return false; // "this network", includes 0.0.0.0
  if (a === 10) return false; // RFC1918
  if (a === 127) return false; // loopback
  if (a === 169 && b === 254) return false; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // RFC1918
  if (a === 192 && b === 168) return false; // RFC1918
  if (a === 192 && b === 0) return false; // IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a >= 224) return false; // multicast, reserved, broadcast
  return true;
}

function isPublicIPv6(address: string): boolean {
  const groups = expandIPv6(address);
  if (!groups) return false;

  // IPv4-mapped (::ffff:a.b.c.d) and NAT64 (64:ff9b::/96) both carry a v4
  // address in the low 32 bits and are the standard way to smuggle one past a
  // v6-only check.
  const mapped =
    groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff;
  const nat64 =
    groups[0] === 0x0064 &&
    groups[1] === 0xff9b &&
    groups.slice(2, 6).every((group) => group === 0);
  if (mapped || nat64) {
    return isPublicIPv4([
      groups[6] >> 8,
      groups[6] & 0xff,
      groups[7] >> 8,
      groups[7] & 0xff,
    ]);
  }

  if (groups.every((group) => group === 0)) return false; // ::
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) {
    return false; // ::1
  }
  if ((groups[0] & 0xfe00) === 0xfc00) return false; // ULA fc00::/7
  if ((groups[0] & 0xffc0) === 0xfe80) return false; // link-local fe80::/10
  if ((groups[0] & 0xff00) === 0xff00) return false; // multicast ff00::/8
  return true;
}

function expandIPv6(address: string): number[] | null {
  const [head, tail, ...rest] = address.split("::");
  if (rest.length > 0) return null;

  const toGroups = (part: string): number[] => {
    if (!part) return [];
    const segments = part.split(":");
    const last = segments[segments.length - 1];
    // A trailing dotted quad occupies the final two groups.
    if (last.includes(".")) {
      const [a, b, c, d] = parseIPv4(last);
      return [
        ...segments.slice(0, -1).map((group) => Number.parseInt(group, 16)),
        (a << 8) | b,
        (c << 8) | d,
      ];
    }
    return segments.map((group) => Number.parseInt(group, 16));
  };

  const left = toGroups(head);
  const right = tail === undefined ? [] : toGroups(tail);
  const filler = 8 - left.length - right.length;
  if (tail === undefined) return left.length === 8 ? left : null;
  if (filler < 0) return null;
  return [...left, ...Array<number>(filler).fill(0), ...right];
}
