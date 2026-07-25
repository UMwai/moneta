import { z } from "zod";

import { safeMessage } from "@/lib/providers/errors";
import { ApiException, apiHandler, parseJson } from "@/lib/server/api";
import { resolveProvider } from "@/lib/server/providers";
import { encryptCredentials } from "@/lib/server/secrets";
import { store } from "@/lib/server/store";

const connectionSchema = z
  .object({
    provider: z.enum(["plaid", "simplefin", "teller", "manual"]),
    credentials: z.unknown(),
  })
  .strict()
  .refine((value) => Object.hasOwn(value, "credentials"), {
    message: "credentials are required",
  });

export async function GET(): Promise<Response> {
  return apiHandler(() => store.listConnections());
}

export async function POST(request: Request): Promise<Response> {
  return apiHandler(
    async () => {
      const { provider, credentials } = await parseJson(
        request,
        connectionSchema,
      );

      // Validate before storing. A connection whose credentials never worked is
      // worse than no connection at all: it looks healthy until the first sync.
      let outcome: { ok: boolean; message?: string };
      try {
        outcome = await resolveProvider(provider).test(credentials);
      } catch (error) {
        throw new ApiException(
          400,
          "PROVIDER_TEST_FAILED",
          safeMessage(error, "Could not validate these credentials."),
        );
      }
      if (!outcome.ok) {
        throw new ApiException(
          400,
          "PROVIDER_TEST_FAILED",
          outcome.message ?? "The provider rejected these credentials.",
        );
      }

      return store.createConnection(provider, encryptCredentials(credentials));
    },
    { status: 201 },
  );
}
