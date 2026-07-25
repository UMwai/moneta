import { z } from "zod";

import { ApiException, apiHandler } from "@/lib/server/api";
import {
  isImportParseError,
  parseImportFile,
} from "@/lib/server/import";
import { store } from "@/lib/server/store";

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
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
    // `formData()` buffers the whole body, so an oversized upload has to be
    // refused from the declared length first; the check below the parse stays
    // as the backstop for a request that lied or omitted the header.
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMPORT_BYTES) {
      throw new ApiException(
        413,
        "CSV_TOO_LARGE",
        "CSV file must not exceed 5 MiB",
      );
    }

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
    if (upload.size > MAX_IMPORT_BYTES) {
      throw new ApiException(
        413,
        "CSV_TOO_LARGE",
        "CSV file must not exceed 5 MiB",
      );
    }
    if (accountId) {
      const accounts = await store.listAccounts();
      if (!accounts.some((account) => account.id === accountId)) {
        throw new ApiException(404, "ACCOUNT_NOT_FOUND", "Account not found");
      }
    }

    // The route is named for CSV but OFX/QFX exports are accepted too; the
    // format is decided by the filename with a content sniff as backstop.
    let parsed;
    try {
      parsed = parseImportFile(await upload.text(), upload.name);
    } catch (error) {
      if (isImportParseError(error)) {
        throw new ApiException(400, "INVALID_CSV", (error as Error).message);
      }
      throw error;
    }

    if (parsed.transactions.length === 0) {
      throw new ApiException(
        400,
        "INVALID_CSV",
        "No transactions could be read from this file.",
      );
    }

    return store.importTransactions({
      transactions: parsed.transactions,
      accounts: parsed.accounts,
      categoryByExternalId: parsed.categoryByExternalId,
      accountId,
    });
  });
}
