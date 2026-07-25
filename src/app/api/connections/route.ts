import { z } from "zod";

import { apiHandler, parseJson } from "@/lib/server/api";
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
      const encryptedCredentials = encryptCredentials(credentials);
      return store.createConnection(provider, encryptedCredentials);
    },
    { status: 201 },
  );
}
