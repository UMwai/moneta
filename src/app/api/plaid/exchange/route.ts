import { z } from "zod";

import { safeMessage } from "@/lib/providers/errors";
import { exchangePublicToken } from "@/lib/providers/plaid";
import { ApiException, apiHandler, parseJson } from "@/lib/server/api";
import { resolvePlaidClientCredentials } from "@/lib/server/plaid-credentials";
import { encryptCredentials } from "@/lib/server/secrets";
import { store } from "@/lib/server/store";

const institutionSchema = z
  .object({
    institution_id: z.string().trim().min(1),
    name: z.string().trim().min(1),
  })
  .strict();

const exchangeSchema = z
  .object({
    publicToken: z.string().trim().min(1, "publicToken is required"),
    institution: institutionSchema.nullish(),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  return apiHandler(
    async () => {
      const { publicToken, institution } = await parseJson(
        request,
        exchangeSchema,
      );
      const clientCredentials = await resolvePlaidClientCredentials();

      let accessToken: string;
      try {
        ({ accessToken } = await exchangePublicToken(
          clientCredentials,
          publicToken,
        ));
      } catch (error) {
        throw new ApiException(
          502,
          "PLAID_EXCHANGE_FAILED",
          safeMessage(error, "Plaid could not finish the bank connection."),
        );
      }

      const connection = await store.createConnection(
        "plaid",
        encryptCredentials({ ...clientCredentials, accessToken }),
        institution?.name ?? null,
      );
      await store.syncConnection(connection.id);
      return connection;
    },
    { status: 201 },
  );
}
