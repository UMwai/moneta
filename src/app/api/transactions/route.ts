import type { NextRequest } from "next/server";
import { z } from "zod";

import { apiHandler } from "@/lib/server/api";
import { store } from "@/lib/server/store";

const querySchema = z
  .object({
    accountId: z.string().min(1).optional(),
    categoryId: z.string().min(1).optional(),
    q: z.string().trim().min(1).max(200).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    limit: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(100))
      .default(50),
    offset: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(0))
      .default(0),
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: "from must not be after to",
  });

export async function GET(request: NextRequest): Promise<Response> {
  return apiHandler(async () => {
    const filters = querySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    return store.listTransactions(filters);
  });
}
