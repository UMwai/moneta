/**
 * Merchant-string normalization shared by categorization, recurring detection and
 * the duplicate-charge rule. Provider descriptors are noisy and inconsistent
 * ("SQ *NETFLIX #4821 07/12 PPD ID:1234"); every consumer needs the same idea of
 * what counts as "the same merchant".
 */

/** lowercase, punctuation collapsed to single spaces, trimmed */
export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "merchant name" haystack used for rule matching */
export function haystack(tx: { name: string; merchant?: string | null }): string {
  return normalizeText(`${tx.merchant ?? ""} ${tx.name}`);
}

const NOISE_TOKENS = new Set([
  "pos", "purchase", "debit", "credit", "card", "visa", "mastercard", "amex",
  "recurring", "autopay", "auto", "pay", "payment", "pmt", "ach", "ppd", "web",
  "tel", "id", "ref", "trans", "transaction", "des", "indn", "co", "inc", "llc",
  "the", "usa", "us", "http", "https", "www", "com", "net", "org", "xxxx", "x",
]);

/**
 * Collapses a descriptor down to a merchant identity, dropping store numbers,
 * reference ids and processor noise so the same charge groups across months.
 */
export function normalizeMerchantKey(tx: {
  name: string;
  merchant?: string | null;
}): string {
  const source = tx.merchant?.trim() ? tx.merchant : tx.name;
  const tokens = normalizeText(source)
    .split(" ")
    .filter((t) => t.length > 0)
    .filter((t) => !/^\d+$/.test(t))
    .filter((t) => !/^[a-z]?\d[a-z0-9]*$/.test(t))
    .filter((t) => !NOISE_TOKENS.has(t));
  const key = tokens.slice(0, 3).join(" ");
  return key || normalizeText(source);
}
