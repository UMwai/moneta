import { z } from "zod";

import { hashPassword, verifyPassword } from "@/lib/auth/passwords";
import { loginRateLimiter } from "@/lib/auth/ratelimit";
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

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
}

export async function POST(request: Request): Promise<Response> {
  const key = clientKey(request);
  const rateLimit = loginRateLimiter.consume(key);
  if (!rateLimit.allowed) {
    return errorResponse(
      429,
      "RATE_LIMITED",
      "Too many login attempts; try again later",
      { "Retry-After": String(rateLimit.retryAfterSeconds) },
    );
  }

  return apiHandler(
    async () => {
      const { username, password } = await parseJson(
        request,
        credentialsSchema,
      );
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

      await setSession({ id: user.id, username: user.username });
      loginRateLimiter.reset(key);
      return { ok: true as const };
    },
    { authenticated: false },
  );
}
