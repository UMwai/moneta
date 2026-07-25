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

/** Turn an unknown thrown value into a message with no chance of leaking a secret. */
export function safeMessage(err: unknown, fallback = "Unexpected provider error"): string {
  if (err instanceof ProviderError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
