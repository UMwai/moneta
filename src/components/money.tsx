import { formatMoney } from "@/lib/ui/format";

export function Money({
  value,
  currency = "USD",
  color = false,
  showPlus = false,
  className = "",
}: {
  value: number;
  currency?: string;
  color?: boolean;
  showPlus?: boolean;
  className?: string;
}) {
  const tone = color
    ? value > 0
      ? "money-positive"
      : value < 0
        ? "money-negative"
        : ""
    : "";

  return (
    <span className={`money ${tone} ${className}`}>
      {formatMoney(value, currency, { showPlus })}
    </span>
  );
}
