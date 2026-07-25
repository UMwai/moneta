import { Money } from "@/components/money";
import type { Account, Category, Transaction } from "@/lib/types";
import { formatDate } from "@/lib/ui/format";

export function TransactionList({
  transactions,
  accounts,
  categories,
  editable = false,
  updatingId,
  onCategoryChange,
}: {
  transactions: Transaction[];
  accounts: Account[];
  categories: Category[];
  editable?: boolean;
  updatingId?: string | null;
  onCategoryChange?: (transaction: Transaction, categoryId: string | null) => void;
}) {
  const accountNames = new Map(accounts.map((account) => [account.id, account.name]));
  const categoryNames = new Map(categories.map((category) => [category.id, category.name]));

  return (
    <div className="table-scroll">
      <table className="data-table transaction-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th>Account</th>
            <th>Category</th>
            <th className="align-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((transaction) => (
            <tr key={transaction.id}>
              <td className="date-cell">{formatDate(transaction.date, { month: "short", day: "numeric" })}</td>
              <td>
                <div className="transaction-name">
                  <strong>{transaction.merchant ?? transaction.name}</strong>
                  {transaction.merchant && transaction.merchant !== transaction.name ? (
                    <small>{transaction.name}</small>
                  ) : null}
                  {transaction.pending ? <span className="pending-badge">Pending</span> : null}
                </div>
              </td>
              <td>{accountNames.get(transaction.accountId) ?? "Unknown account"}</td>
              <td>
                {editable ? (
                  <select
                    className="inline-select"
                    value={transaction.categoryId ?? ""}
                    disabled={updatingId === transaction.id}
                    aria-label={`Category for ${transaction.name}`}
                    onChange={(event) =>
                      onCategoryChange?.(transaction, event.target.value || null)
                    }
                  >
                    <option value="">Uncategorized</option>
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className={transaction.categoryId ? "" : "muted"}>
                    {transaction.categoryId
                      ? categoryNames.get(transaction.categoryId) ?? "Unknown"
                      : "Uncategorized"}
                  </span>
                )}
              </td>
              <td className="align-right">
                <Money
                  value={transaction.amount}
                  currency={transaction.currency}
                  color
                  showPlus
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
