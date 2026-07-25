import type { NextRequest } from "next/server";
import { z } from "zod";

import { apiHandler } from "@/lib/server/api";
import { store } from "@/lib/server/store";

const querySchema = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .strict()
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: "from must not be after to",
  });

export async function GET(request: NextRequest): Promise<Response> {
  return apiHandler(async () => {
    const { from, to } = querySchema.parse(
      Object.fromEntries(request.nextUrl.searchParams),
    );
    return store.listNetWorth(from, to);
  });
}
