/**
 * Error types shared by the bank adapters. Messages are safe to surface to the user
 * and must never embed credentials, tokens, or raw provider responses.
 */

export class ProviderError extends Error {
  readonly provider: string;
  readonly code: string;

  constructor(provider: string, message: string, code = "provider_error") {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.code = code;
  }
}

export class NotImplementedError extends ProviderError {
  constructor(provider: string, message: string) {
    super(provider, message, "not_implemented");
    this.name = "NotImplementedError";
  }
}

export class CredentialsError extends ProviderError {
  constructor(provider: string, message: string) {
    super(provider, message, "invalid_credentials");
    this.name = "CredentialsError";
  }
}

/**
 * Turn an unknown thrown value into a message with no chance of leaking a secret.
 *
 * Only `ProviderError` messages are written by this codebase and reviewed to be
 * free of credentials. Anything else — a `TypeError` from undici, which quotes
 * the request URL ("Failed to parse URL from https://user:pass@…"), a driver
 * error quoting a row — is replaced wholesale by the fallback.
 */
export function safeMessage(err: unknown, fallback = "Unexpected provider error"): string {
  if (err instanceof ProviderError && err.message) return err.message;
  return fallback;
}

const MAX_STATUS_MESSAGE_LENGTH = 200;
/** Any absolute URL: the SimpleFIN claim and access URLs are themselves secrets. */
const ABSOLUTE_URL = /[a-z][a-z0-9+.-]*:\/\/\S+/gi;

/**
 * Last gate before a provider message is persisted to `connections.last_error`,
 * which is stored in the clear. Strips URLs and clamps the length so a message
 * that slipped past `safeMessage` cannot park a credential in the database.
 */
export function safeStatusMessage(
  message: string,
  fallback = "The provider could not be reached.",
): string {
  const redacted = message
    .replace(ABSOLUTE_URL, "[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  if (!redacted || redacted === "[redacted]") return fallback;
  return redacted.length > MAX_STATUS_MESSAGE_LENGTH
    ? `${redacted.slice(0, MAX_STATUS_MESSAGE_LENGTH - 1)}…`
    : redacted;
}
