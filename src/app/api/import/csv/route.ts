import { z } from "zod";

import { ApiException, apiHandler } from "@/lib/server/api";
import {
  CsvParseError,
  parseTransactionCsv,
} from "@/lib/server/csv";
import { store } from "@/lib/server/store";

const MAX_CSV_BYTES = 5 * 1024 * 1024;
const multipartSchema = z
  .object({
    file: z.instanceof(File),
    accountId: z.preprocess(
      (value) => (value === "" || value === null ? undefined : value),
      z.string().trim().min(1).optional(),
    ),
  })
  .strict();

export async function POST(request: Request): Promise<Response> {
  return apiHandler(async () => {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      throw new ApiException(
        400,
        "INVALID_MULTIPART",
        "Request must contain multipart form data",
      );
    }

    const { file: upload, accountId } = multipartSchema.parse({
      file: form.get("file"),
      accountId: form.get("accountId"),
    });
    if (upload.size > MAX_CSV_BYTES) {
      throw new ApiException(
        413,
        "CSV_TOO_LARGE",
        "CSV file must not exceed 5 MiB",
      );
    }
    if (accountId) {
      const accounts = await store.listAccounts();
      if (!accounts.some((account) => account.id === accountId)) {
        throw new ApiException(
          404,
          "ACCOUNT_NOT_FOUND",
          "Account not found",
        );
      }
    }

    try {
      const rows = parseTransactionCsv(await upload.text());
      return store.importCsv(rows, accountId);
    } catch (error) {
      if (error instanceof CsvParseError) {
        throw new ApiException(400, "INVALID_CSV", error.message);
      }
      throw error;
    }
  });
}
