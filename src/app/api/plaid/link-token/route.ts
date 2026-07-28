import { safeMessage } from "@/lib/providers/errors";
import { createLinkToken } from "@/lib/providers/plaid";
import {
  ApiException,
  apiHandler,
  requireLiveSession,
} from "@/lib/server/api";
import { resolvePlaidClientCredentials } from "@/lib/server/plaid-credentials";

export async function POST(): Promise<Response> {
  return apiHandler(async () => {
    const session = await requireLiveSession();
    const credentials = await resolvePlaidClientCredentials();

    try {
      const result = await createLinkToken(credentials, {
        clientUserId: session.id,
      });
      return { linkToken: result.linkToken };
    } catch (error) {
      throw new ApiException(
        502,
        "PLAID_LINK_TOKEN_FAILED",
        safeMessage(error, "Plaid could not start the bank connection flow."),
      );
    }
  });
}
