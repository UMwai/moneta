"use client";

import { Money } from "@/components/money";
import {
  Button,
  EmptyState,
  ErrorState,
  InlineNotice,
  LoadingState,
  PageHeader,
  ProgressBar,
  Surface,
} from "@/components/ui";
import type { BudgetStatus, Category } from "@/lib/types";
import { api, errorMessage } from "@/lib/ui/api";
import {
  currentMonth,
  dollarsToMinorUnits,
  formatMoney,
  formatMonth,
  minorUnitsToDollars,
} from "@/lib/ui/format";
import { CalendarDays, Pencil, Plus, WalletCards } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

export default function BudgetsPage() {
  const [month, setMonth] = useState(currentMonth);
  const [budgets, setBudgets] = useState<BudgetStatus[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextBudgets, nextCategories] = await Promise.all([
        api.budgets(month),
        api.categories(),
      ]);
      setBudgets(nextBudgets);
      setCategories(nextCategories);
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  function retry() {
    setLoading(true);
    void load();
  }

  const totals = useMemo(
    () =>
      budgets.reduce(
        (sum, budget) => ({
          amount: sum.amount + budget.amount,
          spent: sum.spent + budget.spent,
          projected: sum.projected + budget.projected,
        }),
        { amount: 0, spent: 0, projected: 0 },
      ),
    [budgets],
  );

  function editBudget(budget: BudgetStatus) {
    setCategoryId(budget.categoryId);
    setAmount(minorUnitsToDollars(budget.amount));
    setNotice(null);
    document.getElementById("budget-editor")?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

  async function saveBudget(event: FormEvent) {
    event.preventDefault();
    const minorUnits = dollarsToMinorUnits(amount);

    if (!categoryId || minorUnits === null || minorUnits < 0) {
      setError("Choose a category and enter a valid non-negative amount.");
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await api.putBudget({ categoryId, month, amount: minorUnits });
      const category = categories.find((item) => item.id === categoryId);
      setNotice(`${category?.name ?? "Budget"} saved for ${formatMonth(month)}.`);
      setCategoryId("");
      setAmount("");
      await load();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  const isOverProjected = totals.projected > totals.amount;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Monthly plan"
        title="Budgets"
        description="Set category boundaries, watch the run rate, and adjust before the month gets away from you."
        actions={
          <label className="month-picker">
            <CalendarDays size={16} aria-hidden="true" />
            <span className="sr-only">Budget month</span>
            <input
              type="month"
              value={month}
              onChange={(event) => {
                setLoading(true);
                setMonth(event.target.value);
              }}
            />
          </label>
        }
      />

      {!loading && budgets.length ? (
        <Surface className="budget-overview">
          <div>
            <span>{formatMonth(month)}</span>
            <strong>{formatMoney(totals.amount)} planned</strong>
          </div>
          <div className="budget-overview-stats">
            <div>
              <span>Spent</span>
              <Money value={totals.spent} />
            </div>
            <div>
              <span>Remaining</span>
              <Money value={totals.amount - totals.spent} />
            </div>
            <div>
              <span>Projected</span>
              <Money
                value={totals.projected}
                className={isOverProjected ? "money-negative" : ""}
              />
            </div>
          </div>
          <ProgressBar
            value={(totals.spent / Math.max(totals.amount, 1)) * 100}
            danger={isOverProjected}
          />
          <p className={isOverProjected ? "forecast-warning" : ""}>
            {isOverProjected
              ? `Projected to exceed the plan by ${formatMoney(totals.projected - totals.amount)}.`
              : `Projected to finish ${formatMoney(totals.amount - totals.projected)} under plan.`}
          </p>
        </Surface>
      ) : null}

      {notice ? <InlineNotice>{notice}</InlineNotice> : null}
      {error && !loading ? <InlineNotice kind="error">{error}</InlineNotice> : null}

      <div className="budgets-layout">
        <Surface className="budget-list">
          <div className="section-heading">
            <div>
              <p className="section-kicker">{formatMonth(month)}</p>
              <h2>Category envelopes</h2>
            </div>
            <span className="row-count">{budgets.length}</span>
          </div>
          {loading ? (
            <LoadingState label="Checking monthly budgets…" />
          ) : error && !budgets.length ? (
            <ErrorState message={error} onRetry={retry} />
          ) : budgets.length ? (
            <div>
              {budgets.map((budget) => {
                const projectedOver = budget.projected > budget.amount;
                const percent = (budget.spent / Math.max(budget.amount, 1)) * 100;

                return (
                  <article className="budget-row" key={budget.id}>
                    <div className="budget-row-main">
                      <div className="budget-row-title">
                        <span aria-hidden="true">
                          {budget.categoryName.charAt(0).toUpperCase()}
                        </span>
                        <div>
                          <h3>{budget.categoryName}</h3>
                          <p>
                            <Money value={budget.spent} /> of{" "}
                            <Money value={budget.amount} />
                          </p>
                        </div>
                      </div>
                      <div className="budget-row-values">
                        <div>
                          <span>Remaining</span>
                          <Money value={budget.remaining} />
                        </div>
                        <div>
                          <span>Projected</span>
                          <Money
                            value={budget.projected}
                            className={projectedOver ? "money-negative" : ""}
                          />
                        </div>
                        <Button
                          variant="ghost"
                          onClick={() => editBudget(budget)}
                          aria-label={`Edit ${budget.categoryName} budget`}
                        >
                          <Pencil size={15} aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                    <ProgressBar value={percent} danger={projectedOver} />
                    <p className={`budget-forecast ${projectedOver ? "forecast-warning" : ""}`}>
                      {projectedOver
                        ? `${formatMoney(budget.projected - budget.amount)} over at current pace`
                        : `${Math.round(percent)}% used`}
                    </p>
                  </article>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={<WalletCards size={22} />}
              title={`No budgets for ${formatMonth(month)}`}
              body="Add a category envelope to turn this month into an intentional plan."
            />
          )}
        </Surface>

        <Surface className="budget-editor" id="budget-editor">
          <div className="editor-accent">
            <Plus size={18} aria-hidden="true" />
          </div>
          <h2>Add or update a budget</h2>
          <p>
            Saving the same category and month updates its amount. Values are entered
            in dollars and stored safely as integer cents.
          </p>
          <form onSubmit={saveBudget}>
            <div className="form-field">
              <label htmlFor="budget-category">Category</label>
              <select
                id="budget-category"
                className="select"
                required
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
              >
                <option value="">Choose a category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="budget-amount">Monthly amount</label>
              <div className="money-input">
                <span>$</span>
                <input
                  id="budget-amount"
                  className="input"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  required
                  placeholder="0.00"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                />
              </div>
            </div>
            <Button type="submit" loading={saving}>
              Save budget
            </Button>
          </form>
        </Surface>
      </div>
    </div>
  );
}
