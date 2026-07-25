import { clearSession } from "@/lib/auth/session";
import { apiHandler } from "@/lib/server/api";

export async function POST(): Promise<Response> {
  return apiHandler(
    async () => {
      await clearSession();
      return { ok: true as const };
    },
    { authenticated: false },
  );
}
