import { apiHandler } from "@/lib/server/api";
import { store } from "@/lib/server/store";

export async function GET(): Promise<Response> {
  return apiHandler(() => store.listAccounts());
}
