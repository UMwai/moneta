import { z } from "zod";

import { clientAddressKey } from "@/lib/auth/client-address";
import { hashPassword, verifyPassword } from "@/lib/auth/passwords";
import {
  loginAccountRateLimiter,
  loginRateLimiter,
  type RateLimitResult,
} from "@/lib/auth/ratelimit";
import { setSession } from "@/lib/auth/session";
import {
  ApiException,
  apiHandler,
  errorResponse,
  parseJson,
} from "@/lib/server/api";
import { store } from "@/lib/server/store";

const credentialsSchema = z
  .object({
    username: z.string().trim().min(1).max(64),
    password: z.string().min(1).max(1024),
  })
  .strict();

let dummyPasswordHash: Promise<string> | undefined;

function rateLimited(result: RateLimitResult): Response {
  return errorResponse(
    429,
    "RATE_LIMITED",
    "Too many login attempts; try again later",
    { "Retry-After": String(result.retryAfterSeconds) },
  );
}

export async function POST(request: Request): Promise<Response> {
  const addressKey = clientAddressKey(request);
  const byAddress = loginRateLimiter.consume(addressKey);
  if (!byAddress.allowed) {
    return rateLimited(byAddress);
  }

  return apiHandler(
    async () => {
      const { username, password } = await parseJson(
        request,
        credentialsSchema,
      );
      // Charged per account as well, because the address key is only as
      // trustworthy as the deployment (see clientAddressKey) while the username
      // is whatever the attacker must actually guess against.
      const accountKey = username.toLowerCase();
      const byAccount = loginAccountRateLimiter.consume(accountKey);
      if (!byAccount.allowed) {
        return rateLimited(byAccount);
      }

      const user = await store.findUserByUsername(username);
      dummyPasswordHash ??= hashPassword("moneta-invalid-password");
      const valid = await verifyPassword(
        user?.passwordHash ?? (await dummyPasswordHash),
        password,
      );
      if (!user || !valid) {
        throw new ApiException(
          401,
          "INVALID_CREDENTIALS",
          "Invalid username or password",
        );
      }

      await setSession({
        id: user.id,
        username: user.username,
        sessionVersion: user.sessionVersion,
      });
      loginRateLimiter.reset(addressKey);
      loginAccountRateLimiter.reset(accountKey);
      return { ok: true as const };
    },
    { authenticated: false },
  );
}
