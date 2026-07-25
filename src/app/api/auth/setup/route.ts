import { z } from "zod";

import { hashPassword } from "@/lib/auth/passwords";
import {
  assertSessionConfigured,
  setSession,
} from "@/lib/auth/session";
import { ApiException, apiHandler, parseJson } from "@/lib/server/api";
import { store } from "@/lib/server/store";

const credentialsSchema = z
  .object({
    username: z.string().trim().min(3).max(64),
    password: z.string().min(8).max(1024),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  return apiHandler(
    async () => {
      if (await store.hasUser()) {
        throw new ApiException(
          409,
          "SETUP_COMPLETE",
          "A user has already been configured",
        );
      }
      assertSessionConfigured();
      const { username, password } = await parseJson(
        request,
        credentialsSchema,
      );
      const passwordHash = await hashPassword(password);
      let user;
      try {
        user = await store.createUser(username, passwordHash);
      } catch {
        throw new ApiException(
          409,
          "SETUP_COMPLETE",
          "A user has already been configured",
        );
      }
      await setSession({
        id: user.id,
        username: user.username,
        sessionVersion: user.sessionVersion,
      });
      return { ok: true as const };
    },
    { authenticated: false, status: 201 },
  );
}
