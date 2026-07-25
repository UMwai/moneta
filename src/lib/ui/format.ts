const DEFAULT_CURRENCY = "USD";

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(currency: string) {
  const normalized = currency.toUpperCase();
  const cached = currencyFormatters.get(normalized);

  if (cached) {
    return cached;
  }

  const formatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: normalized,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  currencyFormatters.set(normalized, formatter);
  return formatter;
}

export function formatMoney(
  minorUnits: number,
  currency = DEFAULT_CURRENCY,
  options: { showPlus?: boolean; absolute?: boolean } = {},
) {
  const value = options.absolute ? Math.abs(minorUnits) : minorUnits;
  const formatted = currencyFormatter(currency).format(value / 100);

  if (options.showPlus && value > 0) {
    return `+${formatted}`;
  }

  return formatted;
}

export function formatCompactMoney(
  minorUnits: number,
  currency = DEFAULT_CURRENCY,
) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(minorUnits / 100);
}

export function dollarsToMinorUnits(value: string) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

export function minorUnitsToDollars(minorUnits: number) {
  return (minorUnits / 100).toFixed(2);
}

export function formatDate(
  value: string,
  options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  },
) {
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? `${value}T12:00:00`
    : value;
  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", options).format(date);
}

export function formatMonth(month: string) {
  const date = new Date(`${month}-01T12:00:00`);

  if (Number.isNaN(date.getTime())) {
    return month;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(date);
}

export function currentMonth() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function relativeTime(value: string | null) {
  if (!value) {
    return "Never";
  }

  const date = new Date(value);
  const elapsed = Date.now() - date.getTime();

  if (!Number.isFinite(elapsed)) {
    return value;
  }

  const minutes = Math.round(Math.abs(elapsed) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;

  return formatDate(value);
}
