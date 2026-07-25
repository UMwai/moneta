/** Money is stored as an integer number of minor units (cents). */

export function toMajor(minor: number): number {
  return minor / 100;
}

export function formatMoney(minor: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: Math.abs(minor) % 100 === 0 ? 0 : 2,
      minimumFractionDigits: Math.abs(minor) % 100 === 0 ? 0 : 2,
    }).format(toMajor(minor));
  } catch {
    return `${toMajor(minor).toFixed(2)} ${currency}`;
  }
}

export function formatPercent(ratio: number, digits = 0): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** Outflow magnitude of a signed amount; inflows contribute 0. */
export function outflow(amount: number): number {
  return amount < 0 ? -amount : 0;
}

/** Inflow magnitude of a signed amount; outflows contribute 0. */
export function inflow(amount: number): number {
  return amount > 0 ? amount : 0;
}
