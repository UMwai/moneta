import { z } from "zod";

import { apiHandler } from "@/lib/server/api";
import { store } from "@/lib/server/store";

const idSchema = z.string().min(1);

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(
  _request: Request,
  context: RouteContext,
): Promise<Response> {
  return apiHandler(async () => {
    const id = idSchema.parse((await context.params).id);
    // A missing connection, undecryptable credentials and an unreachable
    // provider all surface through apiHandler's error mapping.
    return store.syncConnection(id);
  });
}
