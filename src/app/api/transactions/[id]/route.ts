import { z } from "zod";

import { ApiException, apiHandler, parseJson } from "@/lib/server/api";
import { store } from "@/lib/server/store";

const patchSchema = z
  .object({
    categoryId: z.string().min(1).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      Object.hasOwn(value, "categoryId") || Object.hasOwn(value, "notes"),
    { message: "At least one field is required" },
  );
const idSchema = z.string().min(1);

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  return apiHandler(async () => {
    const id = idSchema.parse((await context.params).id);
    const patch = await parseJson(request, patchSchema);
    if (
      patch.categoryId &&
      !(await store.hasCategory(patch.categoryId))
    ) {
      throw new ApiException(400, "INVALID_CATEGORY", "Category not found");
    }
    const transaction = await store.updateTransaction(id, patch);
    if (!transaction) {
      throw new ApiException(
        404,
        "TRANSACTION_NOT_FOUND",
        "Transaction not found",
      );
    }
    return transaction;
  });
}
