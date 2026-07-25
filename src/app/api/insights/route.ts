import type { NextRequest } from "next/server";
import { z } from "zod";

import { apiHandler } from "@/lib/server/api";
import { store } from "@/lib/server/store";

const periodSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "period must be YYYY-MM");

export async function GET(request: NextRequest): Promise<Response> {
  return apiHandler(async () => {
    const period = periodSchema.parse(
      request.nextUrl.searchParams.get("period"),
    );
    return store.listInsights(period);
  });
}
