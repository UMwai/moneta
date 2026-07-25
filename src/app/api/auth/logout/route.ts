import { clearSession, getSession } from "@/lib/auth/session";
import { apiHandler } from "@/lib/server/api";
import { store } from "@/lib/server/store";

export async function POST(): Promise<Response> {
  return apiHandler(
    async () => {
      // Clearing the cookie only disarms this browser; bumping the session
      // version is what stops a copy of the token that was taken beforehand.
      const session = await getSession();
      if (session) {
        await store.revokeSessions(session.id);
      }
      await clearSession();
      return { ok: true as const };
    },
    { authenticated: false },
  );
}
