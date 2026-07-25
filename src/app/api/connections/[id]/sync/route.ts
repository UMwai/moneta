import { z } from "zod";

import { ApiException, apiHandler } from "@/lib/server/api";
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
    if (!(await store.hasConnection(id))) {
      throw new ApiException(
        404,
        "CONNECTION_NOT_FOUND",
        "Connection not found",
      );
    }
    // TODO(M5): invoke the matching BankProvider and persist its SyncResult.
    return { added: 0, modified: 0 };
  });
}
