import {
  plaidCredentialsSchema,
  type PlaidCredentials,
} from "@/lib/providers/plaid";
import { ApiException } from "@/lib/server/api";
import { decryptCredentials } from "@/lib/server/secrets";
import { store } from "@/lib/server/store";

export type PlaidClientCredentials = Pick<
  PlaidCredentials,
  "clientId" | "secret" | "env"
>;

function withoutAccessToken(
  credentials: PlaidCredentials,
): PlaidClientCredentials {
  return {
    clientId: credentials.clientId,
    secret: credentials.secret,
    env: credentials.env,
  };
}

function environmentCredentials(): PlaidClientCredentials | null {
  const clientId = process.env.PLAID_CLIENT_ID?.trim();
  const secret = process.env.PLAID_SECRET?.trim();
  const env = process.env.PLAID_ENV?.trim() || "sandbox";

  if (!clientId && !secret) return null;

  const parsed = plaidCredentialsSchema.safeParse({ clientId, secret, env });
  if (!parsed.success) {
    throw new ApiException(
      500,
      "PLAID_ENV_INVALID",
      "Plaid environment credentials are incomplete or PLAID_ENV is invalid.",
    );
  }
  return withoutAccessToken(parsed.data);
}

/**
 * Prefer the credentials-only Plaid record saved from Settings. If an older
 * install only has linked records, reuse its client credentials without its
 * item-specific access token so Link opens in create mode.
 */
export async function resolvePlaidClientCredentials(): Promise<PlaidClientCredentials> {
  const records = await store.listConnectionCredentialRecords("plaid");
  let linkedFallback: PlaidClientCredentials | null = null;

  for (const record of records) {
    const parsed = plaidCredentialsSchema.safeParse(
      decryptCredentials(record.encryptedCredentials),
    );
    if (!parsed.success) continue;

    const clientCredentials = withoutAccessToken(parsed.data);
    if (!parsed.data.accessToken) return clientCredentials;
    linkedFallback ??= clientCredentials;
  }

  const credentials = linkedFallback ?? environmentCredentials();
  if (!credentials) {
    throw new ApiException(
      400,
      "PLAID_NOT_CONFIGURED",
      "Configure Plaid client credentials in Settings or set PLAID_CLIENT_ID and PLAID_SECRET.",
    );
  }
  return credentials;
}
