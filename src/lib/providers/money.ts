/**
 * Money parsing helpers. Everything in Moneta is stored in minor units (integer
 * cents), so every conversion here goes through string arithmetic — floats are only
 * used where an upstream SDK already handed us one, and even then never multiplied
 * before rounding.
 */

const CURRENCY_JUNK = /[^\d.,()+-]/g;

export interface ParsedDecimal {
  /** -1 or 1 */
  sign: number;
  /** digits before the decimal separator, no grouping */
  whole: string;
  /** digits after the decimal separator, no grouping */
  fraction: string;
}

/**
 * Split a human-written decimal into sign/whole/fraction without touching a float.
 * Handles `1,234.56`, `1.234,56`, `(12.30)`, `-12.30`, `12.30-`, `$1 234,56`, `.5`.
 * Returns null when the input holds no digits.
 */
export function parseDecimalString(input: string): ParsedDecimal | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const parenthesised = /^\(.*\)$/.test(trimmed);
  const cleaned = trimmed.replace(CURRENCY_JUNK, "");
  const negative =
    parenthesised || cleaned.includes("(") || cleaned.startsWith("-") || cleaned.endsWith("-");

  const digitsAndSeps = cleaned.replace(/[()+-]/g, "");
  if (!/\d/.test(digitsAndSeps)) return null;

  const lastDot = digitsAndSeps.lastIndexOf(".");
  const lastComma = digitsAndSeps.lastIndexOf(",");
  let decimalIndex = -1;

  if (lastDot >= 0 && lastComma >= 0) {
    // Whichever separator comes last is the decimal one: 1.234,56 vs 1,234.56
    decimalIndex = Math.max(lastDot, lastComma);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const index = Math.max(lastDot, lastComma);
    const tail = digitsAndSeps.slice(index + 1);
    // A lone separator with a three-digit tail is genuinely ambiguous (`1,234` is one
    // thousand two hundred; `1.234` is that same number in de-DE). Resolve it the
    // en-US way — comma groups, dot divides — which is right for the overwhelming
    // majority of exports. European files are still handled correctly whenever they
    // carry a decimal part (`1.234,56`), since that hits the branch above.
    const isGrouping = digitsAndSeps[index] === "," && /^\d{3}$/.test(tail);
    decimalIndex = isGrouping ? -1 : index;
  }

  const wholeRaw = decimalIndex >= 0 ? digitsAndSeps.slice(0, decimalIndex) : digitsAndSeps;
  const fractionRaw = decimalIndex >= 0 ? digitsAndSeps.slice(decimalIndex + 1) : "";

  const whole = wholeRaw.replace(/\D/g, "");
  const fraction = fractionRaw.replace(/\D/g, "");
  if (!whole && !fraction) return null;

  return { sign: negative ? -1 : 1, whole: whole || "0", fraction };
}

/**
 * Convert a decimal money string to minor units. Rounds half-away-from-zero when the
 * source carries more than two fractional digits. Returns null on unparseable input.
 */
export function decimalStringToMinor(input: string, exponent = 2): number | null {
  const parsed = parseDecimalString(input);
  if (!parsed) return null;
  return assembleMinor(parsed, exponent);
}

function assembleMinor(parsed: ParsedDecimal, exponent: number): number {
  const { sign, whole, fraction } = parsed;
  const kept = fraction.slice(0, exponent).padEnd(exponent, "0");
  const next = fraction.charAt(exponent);
  const base = BigInt(whole) * BigInt(10 ** exponent) + BigInt(kept || "0");
  const rounded = next && Number(next) >= 5 ? base + BigInt(1) : base;
  const minor = sign * Number(rounded);
  // Normalise -0 so callers can compare with === / Object.is.
  return minor === 0 ? 0 : minor;
}

/**
 * Convert a number that an SDK already gave us in major units (Plaid hands out
 * `12.34`) to minor units without float drift from `x * 100`.
 */
export function numberToMinor(value: number, exponent = 2): number {
  if (!Number.isFinite(value)) return 0;
  // toFixed rounds using the float's exact decimal expansion; from there on it is
  // integer arithmetic, so `x * 100` never touches a fractional float.
  const fixed = value.toFixed(exponent);
  const negative = fixed.startsWith("-");
  const [whole, fraction = ""] = (negative ? fixed.slice(1) : fixed).split(".");
  const minor = Number(whole) * 10 ** exponent + Number(fraction.padEnd(exponent, "0") || "0");
  if (!Number.isFinite(minor) || minor === 0) return 0;
  return negative ? -minor : minor;
}

/** Best-effort ISO-4217 normalisation; providers occasionally send URLs or blanks. */
export function normalizeCurrency(value: string | null | undefined, fallback = "USD"): string {
  if (!value) return fallback;
  const upper = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(upper) ? upper : fallback;
}
