import { requireSession } from "@/lib/auth/session";
import { apiHandler } from "@/lib/server/api";

export async function GET(): Promise<Response> {
  return apiHandler(() => requireSession());
}
