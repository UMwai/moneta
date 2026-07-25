"use client";

import { TransactionList } from "@/components/transaction-list";
import {
  Button,
  EmptyState,
  ErrorState,
  InlineNotice,
  LoadingState,
  PageHeader,
  Surface,
} from "@/components/ui";
import type { Account, Category, Paginated, Transaction } from "@/lib/types";
import { api, errorMessage, type TransactionQuery } from "@/lib/ui/api";
import { ArrowLeft, ArrowRight, Search, SlidersHorizontal } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";

const PAGE_SIZE = 25;

type FilterState = {
  q: string;
  accountId: string;
  categoryId: string;
  from: string;
  to: string;
};

const emptyFilters: FilterState = {
  q: "",
  accountId: "",
  categoryId: "",
  from: "",
  to: "",
};

export default function TransactionsPage() {
  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(emptyFilters);
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<Paginated<Transaction>>({
    items: [],
    total: 0,
    limit: PAGE_SIZE,
    offset: 0,
  });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadTransactions = useCallback(async () => {
    const query: TransactionQuery = {
      ...appliedFilters,
      limit: PAGE_SIZE,
      offset,
    };

    try {
      const transactions = await api.transactions(query);
      setResult(transactions);
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [appliedFilters, offset]);

  useEffect(() => {
    const task = window.setTimeout(() => void loadTransactions(), 0);
    return () => window.clearTimeout(task);
  }, [loadTransactions]);

  useEffect(() => {
    async function loadFilters() {
      const [accountResult, categoryResult] = await Promise.allSettled([
        api.accounts(),
        api.categories(),
      ]);
      if (accountResult.status === "fulfilled") setAccounts(accountResult.value);
      if (categoryResult.status === "fulfilled") setCategories(categoryResult.value);
    }
    void loadFilters();
  }, []);

  function submitFilters(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setOffset(0);
    setAppliedFilters(filters);
  }

  function clearFilters() {
    setLoading(true);
    setFilters(emptyFilters);
    setAppliedFilters(emptyFilters);
    setOffset(0);
  }

  function retry() {
    setLoading(true);
    void loadTransactions();
  }

  async function updateCategory(
    transaction: Transaction,
    categoryId: string | null,
  ) {
    const previous = result.items;
    setNotice(null);
    setUpdatingId(transaction.id);
    setResult((current) => ({
      ...current,
      items: current.items.map((item) =>
        item.id === transaction.id ? { ...item, categoryId } : item,
      ),
    }));

    try {
      const updated = await api.updateTransaction(transaction.id, { categoryId });
      setResult((current) => ({
        ...current,
        items: current.items.map((item) =>
          item.id === updated.id ? updated : item,
        ),
      }));
      setNotice(`Category updated for ${transaction.merchant ?? transaction.name}.`);
    } catch (updateError) {
      setResult((current) => ({ ...current, items: previous }));
      setError(errorMessage(updateError));
    } finally {
      setUpdatingId(null);
    }
  }

  const start = result.total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + PAGE_SIZE, result.total);
  const hasFilters = Object.values(appliedFilters).some(Boolean);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Complete ledger"
        title="Transactions"
        description="Search, filter, and keep categorization accurate. Money in is green; money out is coral."
      />

      <Surface className="filter-panel">
        <form onSubmit={submitFilters} className="transaction-filters">
          <div className="form-field search-field">
            <label htmlFor="transaction-search">Search</label>
            <div className="input-with-icon">
              <Search size={15} aria-hidden="true" />
              <input
                id="transaction-search"
                className="input"
                value={filters.q}
                placeholder="Merchant or description"
                onChange={(event) =>
                  setFilters((current) => ({ ...current, q: event.target.value }))
                }
              />
            </div>
          </div>
          <div className="form-field">
            <label htmlFor="account-filter">Account</label>
            <select
              id="account-filter"
              className="select"
              value={filters.accountId}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  accountId: event.target.value,
                }))
              }
            >
              <option value="">All accounts</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="category-filter">Category</label>
            <select
              id="category-filter"
              className="select"
              value={filters.categoryId}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  categoryId: event.target.value,
                }))
              }
            >
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="from-filter">From</label>
            <input
              id="from-filter"
              className="input"
              type="date"
              value={filters.from}
              onChange={(event) =>
                setFilters((current) => ({ ...current, from: event.target.value }))
              }
            />
          </div>
          <div className="form-field">
            <label htmlFor="to-filter">To</label>
            <input
              id="to-filter"
              className="input"
              type="date"
              value={filters.to}
              onChange={(event) =>
                setFilters((current) => ({ ...current, to: event.target.value }))
              }
            />
          </div>
          <div className="filter-actions">
            <Button type="submit">
              <SlidersHorizontal size={15} aria-hidden="true" />
              Apply
            </Button>
            <Button type="button" variant="ghost" onClick={clearFilters}>
              Clear
            </Button>
          </div>
        </form>
      </Surface>

      {notice ? <InlineNotice>{notice}</InlineNotice> : null}

      <Surface className="ledger-panel">
        <div className="ledger-meta">
          <div>
            <span>Ledger results</span>
            <strong>
              {loading
                ? "Counting…"
                : `${result.total.toLocaleString()} transaction${result.total === 1 ? "" : "s"}`}
            </strong>
          </div>
          {hasFilters ? <span className="filter-badge">Filtered view</span> : null}
        </div>
        {loading ? (
          <LoadingState label="Reading the ledger…" />
        ) : error ? (
          <ErrorState message={error} onRetry={retry} />
        ) : result.items.length ? (
          <TransactionList
            transactions={result.items}
            accounts={accounts}
            categories={categories}
            editable
            updatingId={updatingId}
            onCategoryChange={updateCategory}
          />
        ) : (
          <EmptyState
            title={hasFilters ? "No matching transactions" : "No transactions yet"}
            body={
              hasFilters
                ? "Try a broader date range or clear one of the active filters."
                : "Sync a connection or import a CSV in Settings to build your ledger."
            }
            action={
              hasFilters ? (
                <Button variant="secondary" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : null
            }
          />
        )}
        <div className="pagination">
          <span>
            Showing {start}–{end} of {result.total.toLocaleString()}
          </span>
          <div>
            <Button
              variant="secondary"
              disabled={offset === 0 || loading}
              onClick={() => {
                setLoading(true);
                setOffset((current) => Math.max(0, current - PAGE_SIZE));
              }}
            >
              <ArrowLeft size={14} aria-hidden="true" />
              Previous
            </Button>
            <Button
              variant="secondary"
              disabled={offset + PAGE_SIZE >= result.total || loading}
              onClick={() => {
                setLoading(true);
                setOffset((current) => current + PAGE_SIZE);
              }}
            >
              Next
              <ArrowRight size={14} aria-hidden="true" />
            </Button>
          </div>
        </div>
      </Surface>
    </div>
  );
}
