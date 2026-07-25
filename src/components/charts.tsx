"use client";

import type { NetWorthPoint, Transaction } from "@/lib/types";
import { formatCompactMoney, formatDate, formatMoney } from "@/lib/ui/format";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const axisStyle = {
  fontSize: 11,
  fill: "var(--muted)",
  fontFamily: "var(--font-geist-mono)",
};

const tooltipStyle = {
  background: "var(--surface-strong)",
  border: "1px solid var(--line)",
  borderRadius: "10px",
  boxShadow: "var(--shadow)",
  color: "var(--ink)",
  fontSize: "12px",
};

export function NetWorthChart({ points }: { points: NetWorthPoint[] }) {
  const data = points.map((point) => ({
    ...point,
    label: formatDate(point.date, { month: "short", day: "numeric" }),
  }));

  return (
    <div className="chart" aria-label="Net worth over time">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 6, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="netWorthFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.32} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 5" />
          <XAxis
            dataKey="label"
            axisLine={false}
            tickLine={false}
            minTickGap={34}
            tick={axisStyle}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            width={72}
            tick={axisStyle}
            tickFormatter={(value: number) => formatCompactMoney(value)}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            labelStyle={{ color: "var(--muted)", marginBottom: 6 }}
            formatter={(value) => [formatMoney(Number(value)), "Net worth"]}
          />
          <Area
            type="monotone"
            dataKey="net"
            stroke="var(--accent)"
            strokeWidth={2.25}
            fill="url(#netWorthFill)"
            activeDot={{ r: 4, fill: "var(--surface-strong)", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function cashFlowData(transactions: Transaction[]) {
  const today = new Date();
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth() - (5 - index), 1);
    return {
      key: monthKey(date),
      label: new Intl.DateTimeFormat("en-US", { month: "short" }).format(date),
      income: 0,
      spending: 0,
    };
  });
  const byMonth = new Map(months.map((month) => [month.key, month]));

  transactions.forEach((transaction) => {
    if (transaction.pending) return;
    const month = byMonth.get(transaction.date.slice(0, 7));
    if (!month) return;

    if (transaction.amount >= 0) {
      month.income += transaction.amount;
    } else {
      month.spending += Math.abs(transaction.amount);
    }
  });

  return months;
}

export function CashFlowChart({ transactions }: { transactions: Transaction[] }) {
  const data = cashFlowData(transactions);

  return (
    <div className="chart chart-short" aria-label="Income and spending by month">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 2, left: -18, bottom: 0 }} barGap={3}>
          <CartesianGrid vertical={false} stroke="var(--line)" strokeDasharray="3 5" />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tick={axisStyle} />
          <YAxis
            axisLine={false}
            tickLine={false}
            width={68}
            tick={axisStyle}
            tickFormatter={(value: number) => formatCompactMoney(value)}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            cursor={{ fill: "var(--surface-muted)" }}
            formatter={(value, name) => [
              formatMoney(Number(value)),
              name === "income" ? "Income" : "Spending",
            ]}
          />
          <Bar dataKey="income" fill="var(--accent)" radius={[3, 3, 0, 0]} maxBarSize={18} />
          <Bar dataKey="spending" radius={[3, 3, 0, 0]} maxBarSize={18}>
            {data.map((entry) => (
              <Cell key={entry.key} fill="var(--coral)" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
