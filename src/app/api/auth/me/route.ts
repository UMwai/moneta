import { requireSession } from "@/lib/auth/session";
import { apiHandler } from "@/lib/server/api";
import type { SessionUser } from "@/lib/types";

export async function GET(): Promise<Response> {
  return apiHandler(async (): Promise<SessionUser> => {
    // `sessionVersion` is a server-side revocation detail, not part of the
    // SessionUser contract the UI consumes.
    const { id, username } = await requireSession();
    return { id, username };
  });
}
