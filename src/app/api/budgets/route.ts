import type { NextRequest } from "next/server";
import { z } from "zod";

import { ApiException, apiHandler, parseJson } from "@/lib/server/api";
import { store } from "@/lib/server/store";

const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must be YYYY-MM");

const budgetSchema = z
  .object({
    categoryId: z.string().min(1),
    month: monthSchema,
    amount: z.number().int().min(0),
  })
  .strict();

export async function GET(request: NextRequest): Promise<Response> {
  return apiHandler(async () => {
    const month = monthSchema.parse(request.nextUrl.searchParams.get("month"));
    return store.listBudgetStatuses(month);
  });
}

export async function PUT(request: Request): Promise<Response> {
  return apiHandler(async () => {
    const { categoryId, month, amount } = await parseJson(
      request,
      budgetSchema,
    );
    if (!(await store.hasCategory(categoryId))) {
      throw new ApiException(400, "INVALID_CATEGORY", "Category not found");
    }
    return store.upsertBudget(categoryId, month, amount);
  });
}
