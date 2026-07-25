import { ZodError, type ZodType } from "zod";

import {
  SessionRequiredError,
  requireSession,
  type SessionClaims,
} from "@/lib/auth/session";
import { DecryptionError, EncryptionKeyError } from "@/lib/crypto";
import { ImportAccountError } from "@/lib/server/import";
import { store } from "@/lib/server/store";
import { ConnectionNotFoundError, SyncFailedError } from "@/lib/server/sync";
import type { ApiError } from "@/lib/types";

export class ApiException extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiException";
  }
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  headers?: HeadersInit,
): Response {
  return Response.json(
    { error: { code, message } } satisfies ApiError,
    { status, headers },
  );
}

export async function parseJson<T>(
  request: Request,
  schema: ZodType<T>,
): Promise<T> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiException(400, "INVALID_JSON", "Request body must be valid JSON");
  }
  return schema.parse(body);
}

/**
 * The data plane's session check: a valid signature is not enough, the token's
 * `sessionVersion` also has to still match the user row. src/proxy.ts can only
 * check the signature (it has no database), so this is where a logged-out or
 * password-changed cookie is actually turned away.
 */
export async function requireLiveSession(): Promise<SessionClaims> {
  const session = await requireSession();
  const current = await store.sessionVersion(session.id);
  if (current === null || current !== session.sessionVersion) {
    throw new SessionRequiredError();
  }
  return session;
}

export async function apiHandler<T>(
  handler: () => Promise<T | Response>,
  options: { authenticated?: boolean; status?: number } = {},
): Promise<Response> {
  try {
    if (options.authenticated !== false) {
      await requireLiveSession();
    }
    const result = await handler();
    if (result instanceof Response) {
      return result;
    }
    return Response.json(result, { status: options.status ?? 200 });
  } catch (error) {
    if (error instanceof SessionRequiredError) {
      return errorResponse(401, "UNAUTHORIZED", error.message);
    }
    if (error instanceof ApiException) {
      return errorResponse(error.status, error.code, error.message);
    }
    if (error instanceof ZodError) {
      return errorResponse(
        400,
        "VALIDATION_ERROR",
        error.issues[0]?.message ?? "Request validation failed",
      );
    }
    if (error instanceof ConnectionNotFoundError) {
      return errorResponse(404, "CONNECTION_NOT_FOUND", error.message);
    }
    if (error instanceof ImportAccountError) {
      return errorResponse(404, "ACCOUNT_NOT_FOUND", error.message);
    }
    if (error instanceof SyncFailedError) {
      return errorResponse(
        error.status === "reauth_required" ? 401 : 502,
        error.status === "reauth_required"
          ? "REAUTH_REQUIRED"
          : "PROVIDER_SYNC_FAILED",
        error.message,
      );
    }
    // Both of these are operator problems, not user errors, and their messages
    // are written to say what to fix without echoing any credential material.
    if (error instanceof EncryptionKeyError) {
      return errorResponse(500, "ENCRYPTION_KEY_INVALID", error.message);
    }
    if (error instanceof DecryptionError) {
      return errorResponse(500, "CREDENTIALS_UNREADABLE", error.message);
    }
    return errorResponse(500, "INTERNAL_ERROR", "Internal server error");
  }
}
