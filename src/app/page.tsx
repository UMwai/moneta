"use client";

import { CashFlowChart, NetWorthChart } from "@/components/charts";
import { InsightCard } from "@/components/insight-card";
import { Money } from "@/components/money";
import { TransactionList } from "@/components/transaction-list";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  ProgressBar,
  SectionHeading,
  Surface,
  TextLink,
} from "@/components/ui";
import type {
  Account,
  BudgetStatus,
  Category,
  Insight,
  NetWorthPoint,
  Transaction,
} from "@/lib/types";
import { api, errorMessage } from "@/lib/ui/api";
import { currentMonth, formatMoney } from "@/lib/ui/format";
import { Landmark, Lightbulb, WalletCards } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type DashboardData = {
  netWorth: NetWorthPoint[];
  insights: Insight[];
  budgets: BudgetStatus[];
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
};

const emptyData: DashboardData = {
  netWorth: [],
  insights: [],
  budgets: [],
  transactions: [],
  accounts: [],
  categories: [],
};

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData>(emptyData);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dismissing, setDismissing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErrors({});

    const requests = [
      ["netWorth", api.netWorth()],
      ["insights", api.insights(currentMonth())],
      ["budgets", api.budgets(currentMonth())],
      ["transactions", api.transactions({ limit: 250, offset: 0 })],
      ["accounts", api.accounts()],
      ["categories", api.categories()],
    ] as const;

    const results = await Promise.allSettled(requests.map(([, request]) => request));
    const next: DashboardData = { ...emptyData };
    const nextErrors: Record<string, string> = {};

    results.forEach((result, index) => {
      const key = requests[index][0];
      if (result.status === "rejected") {
        nextErrors[key] = errorMessage(result.reason);
        return;
      }

      if (key === "transactions") {
        next.transactions = (result.value as { items: Transaction[] }).items;
      } else {
        Object.assign(next, { [key]: result.value });
      }
    });

    setData(next);
    setErrors(nextErrors);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const latestNetWorth = data.netWorth.at(-1);
  const previousNetWorth = data.netWorth.at(-2);
  const delta =
    latestNetWorth && previousNetWorth
      ? latestNetWorth.net - previousNetWorth.net
      : null;
  const visibleInsights = data.insights.filter((insight) => !insight.dismissed);
  const budgetTotals = useMemo(
    () =>
      data.budgets.reduce(
        (totals, budget) => ({
          amount: totals.amount + budget.amount,
          spent: totals.spent + budget.spent,
          projected: totals.projected + budget.projected,
        }),
        { amount: 0, spent: 0, projected: 0 },
      ),
    [data.budgets],
  );

  async function dismissInsight(id: string) {
    setDismissing(id);
    try {
      await api.dismissInsight(id);
      setData((current) => ({
        ...current,
        insights: current.insights.filter((insight) => insight.id !== id),
      }));
    } catch (error) {
      setErrors((current) => ({ ...current, insights: errorMessage(error) }));
    } finally {
      setDismissing(null);
    }
  }

  return (
    <div className="page dashboard-page">
      <PageHeader
        eyebrow="Financial overview"
        title="Good to see the whole picture."
        description="Balances, movement, and the next useful action—without your financial data leaving this server."
      />

      <div className="dashboard-grid">
        <Surface className="net-worth-panel">
          <div className="net-worth-copy">
            <p className="metric-label">Net worth</p>
            {loading ? (
              <div className="metric-skeleton" />
            ) : latestNetWorth ? (
              <>
                <Money value={latestNetWorth.net} className="net-worth-value" />
                <p className={delta && delta < 0 ? "delta-negative" : "delta-positive"}>
                  {delta === null
                    ? "First snapshot recorded"
                    : `${delta >= 0 ? "↑" : "↓"} ${formatMoney(Math.abs(delta))} since last snapshot`}
                </p>
                <div className="balance-pair">
                  <div>
                    <span>Assets</span>
                    <Money value={latestNetWorth.assets} />
                  </div>
                  <div>
                    <span>Liabilities</span>
                    <Money value={latestNetWorth.liabilities} />
                  </div>
                </div>
              </>
            ) : (
              <div className="metric-empty">
                <strong>No balance history yet</strong>
                <span>Connect an account, then sync to begin your timeline.</span>
              </div>
            )}
          </div>
          <div className="net-worth-chart">
            {loading ? (
              <LoadingState label="Building your balance history…" />
            ) : errors.netWorth ? (
              <ErrorState message={errors.netWorth} onRetry={load} />
            ) : data.netWorth.length ? (
              <NetWorthChart points={data.netWorth} />
            ) : (
              <EmptyState
                icon={<Landmark size={21} />}
                title="Your timeline starts here"
                body="Net worth snapshots will appear after your first account sync."
              />
            )}
          </div>
        </Surface>

        <Surface className="cash-flow-panel">
          <SectionHeading
            label="Last six months"
            title="Cash flow"
            action={<span className="chart-legend"><i /> Income <i /> Spending</span>}
          />
          {loading ? (
            <LoadingState label="Reading cash flow…" />
          ) : errors.transactions ? (
            <ErrorState message={errors.transactions} onRetry={load} />
          ) : data.transactions.length ? (
            <CashFlowChart transactions={data.transactions} />
          ) : (
            <EmptyState
              title="No cash flow to chart"
              body="Import transactions or sync a bank connection to compare income and spending."
            />
          )}
        </Surface>

        <Surface className="insights-panel">
          <SectionHeading
            label="What changed"
            title="Your next moves"
            action={<TextLink href="/insights">All insights</TextLink>}
          />
          {loading ? (
            <LoadingState label="Looking for patterns…" />
          ) : errors.insights ? (
            <ErrorState message={errors.insights} onRetry={load} />
          ) : visibleInsights.length ? (
            visibleInsights
              .slice(0, 3)
              .map((insight) => (
                <InsightCard
                  key={insight.id}
                  insight={insight}
                  dismissing={dismissing === insight.id}
                  onDismiss={dismissInsight}
                />
              ))
          ) : (
            <EmptyState
              icon={<Lightbulb size={21} />}
              title="Nothing needs your attention"
              body="As transaction history grows, Moneta will surface useful changes and suggested actions here."
            />
          )}
        </Surface>

        <Surface className="budget-panel">
          <SectionHeading
            label="This month"
            title="Budget pulse"
            action={<TextLink href="/budgets">View budgets</TextLink>}
          />
          {loading ? (
            <LoadingState label="Checking envelopes…" />
          ) : errors.budgets ? (
            <ErrorState message={errors.budgets} onRetry={load} />
          ) : data.budgets.length ? (
            <div className="budget-summary">
              <div className="budget-stat-row">
                <div>
                  <span>Spent</span>
                  <Money value={budgetTotals.spent} />
                </div>
                <div>
                  <span>Remaining</span>
                  <Money value={budgetTotals.amount - budgetTotals.spent} />
                </div>
                <div>
                  <span>Projected</span>
                  <Money
                    value={budgetTotals.projected}
                    className={
                      budgetTotals.projected > budgetTotals.amount
                        ? "money-negative"
                        : ""
                    }
                  />
                </div>
              </div>
              <ProgressBar
                value={(budgetTotals.spent / Math.max(budgetTotals.amount, 1)) * 100}
                danger={budgetTotals.projected > budgetTotals.amount}
              />
              <p>
                {budgetTotals.projected > budgetTotals.amount
                  ? `At this pace, spending will finish ${formatMoney(
                      budgetTotals.projected - budgetTotals.amount,
                    )} over plan.`
                  : `${formatMoney(
                      budgetTotals.amount - budgetTotals.projected,
                    )} of projected breathing room remains.`}
              </p>
            </div>
          ) : (
            <EmptyState
              icon={<WalletCards size={21} />}
              title="Give every dollar a job"
              body="Set one monthly category budget to begin tracking your plan."
              action={<TextLink href="/budgets">Create a budget</TextLink>}
            />
          )}
        </Surface>

        <Surface className="recent-panel">
          <SectionHeading
            label="Latest activity"
            title="Recent transactions"
            action={<TextLink href="/transactions">View ledger</TextLink>}
          />
          {loading ? (
            <LoadingState label="Loading recent activity…" />
          ) : errors.transactions ? (
            <ErrorState message={errors.transactions} onRetry={load} />
          ) : data.transactions.length ? (
            <TransactionList
              transactions={data.transactions.slice(0, 7)}
              accounts={data.accounts}
              categories={data.categories}
            />
          ) : (
            <EmptyState
              title="Your ledger is ready"
              body="Transactions will appear here after a connection sync or CSV import."
              action={<TextLink href="/settings">Add financial data</TextLink>}
            />
          )}
        </Surface>
      </div>
    </div>
  );
}
