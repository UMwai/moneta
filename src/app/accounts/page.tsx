"use client";

import { Money } from "@/components/money";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  StatusDot,
  Surface,
  TextLink,
} from "@/components/ui";
import type { Account, AccountType, Connection } from "@/lib/types";
import { api, errorMessage } from "@/lib/ui/api";
import { formatDate, formatMoney } from "@/lib/ui/format";
import {
  Banknote,
  Building2,
  CreditCard,
  Landmark,
  PiggyBank,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

const typeDetails: Record<
  AccountType,
  { label: string; icon: typeof Landmark; liability?: boolean }
> = {
  checking: { label: "Checking", icon: Landmark },
  savings: { label: "Savings", icon: PiggyBank },
  credit: { label: "Credit cards", icon: CreditCard, liability: true },
  investment: { label: "Investments", icon: TrendingUp },
  loan: { label: "Loans", icon: Building2, liability: true },
  cash: { label: "Cash", icon: Banknote },
  other: { label: "Other", icon: Wallet },
};

const typeOrder: AccountType[] = [
  "checking",
  "savings",
  "credit",
  "investment",
  "loan",
  "cash",
  "other",
];

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextAccounts, nextConnections] = await Promise.all([
        api.accounts(),
        api.connections().catch(() => []),
      ]);
      setAccounts(nextAccounts.filter((account) => !account.archived));
      setConnections(nextConnections);
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  function retry() {
    setLoading(true);
    void load();
  }

  const grouped = useMemo(
    () =>
      typeOrder
        .map((type) => ({
          type,
          accounts: accounts.filter((account) => account.type === type),
        }))
        .filter((group) => group.accounts.length),
    [accounts],
  );
  const connectionById = new Map(
    connections.map((connection) => [connection.id, connection]),
  );
  const assetTotal = accounts
    .filter((account) => !typeDetails[account.type].liability)
    .reduce((total, account) => total + account.balance, 0);
  const liabilityTotal = accounts
    .filter((account) => typeDetails[account.type].liability)
    .reduce((total, account) => total + Math.abs(account.balance), 0);

  return (
    <div className="page">
      <PageHeader
        eyebrow="Balance sheet"
        title="Accounts"
        description="Every connected, imported, and manual balance in one calm view."
        actions={<TextLink href="/settings">Manage connections</TextLink>}
      />

      {!loading && accounts.length ? (
        <div className="account-totals">
          <Surface>
            <span>Total assets</span>
            <Money value={assetTotal} />
            <small>Across non-debt accounts</small>
          </Surface>
          <Surface>
            <span>Total liabilities</span>
            <Money value={liabilityTotal} />
            <small>Credit and loan balances</small>
          </Surface>
          <Surface>
            <span>Connected accounts</span>
            <strong>{accounts.length}</strong>
            <small>{connections.length} provider connection{connections.length === 1 ? "" : "s"}</small>
          </Surface>
        </div>
      ) : null}

      {loading ? (
        <Surface>
          <LoadingState label="Gathering account balances…" />
        </Surface>
      ) : error ? (
        <Surface>
          <ErrorState message={error} onRetry={retry} />
        </Surface>
      ) : grouped.length ? (
        <div className="account-groups">
          {grouped.map((group) => {
            const detail = typeDetails[group.type];
            const Icon = detail.icon;
            const total = group.accounts.reduce(
              (sum, account) => sum + account.balance,
              0,
            );

            return (
              <section key={group.type} className="account-group">
                <div className="account-group-heading">
                  <div>
                    <span className="account-type-icon">
                      <Icon size={17} aria-hidden="true" />
                    </span>
                    <h2>{detail.label}</h2>
                    <span>{group.accounts.length}</span>
                  </div>
                  <Money value={total} />
                </div>
                <div className="account-card-grid">
                  {group.accounts.map((account) => {
                    const connection = account.connectionId
                      ? connectionById.get(account.connectionId)
                      : null;

                    return (
                      <Surface as="article" className="account-card" key={account.id}>
                        <div className="account-card-top">
                          <div className="institution-mark" aria-hidden="true">
                            {(account.institution ?? account.name).charAt(0).toUpperCase()}
                          </div>
                          {connection ? (
                            <StatusDot status={connection.status} />
                          ) : (
                            <span className="manual-badge">Local</span>
                          )}
                        </div>
                        <p>{account.institution ?? "Manual account"}</p>
                        <h3>{account.name}</h3>
                        <Money
                          value={account.balance}
                          currency={account.currency}
                          className="account-balance"
                        />
                        <div className="account-card-meta">
                          <span>
                            {account.mask ? `•••• ${account.mask}` : account.currency}
                          </span>
                          <span>
                            {account.available !== null
                              ? `${formatMoney(account.available, account.currency)} available`
                              : `Updated ${formatDate(account.updatedAt, {
                                  month: "short",
                                  day: "numeric",
                                })}`}
                          </span>
                        </div>
                      </Surface>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <Surface>
          <EmptyState
            icon={<Landmark size={22} />}
            title="Build your balance sheet"
            body="Connect a bank provider or import a CSV. Your balances remain on this self-hosted instance."
            action={<TextLink href="/settings">Add an account source</TextLink>}
          />
        </Surface>
      )}
    </div>
  );
}
