"use client";

import {
  Button,
  EmptyState,
  InlineNotice,
  LoadingState,
  PageHeader,
  StatusDot,
  Surface,
} from "@/components/ui";
import type { Account, Connection, ProviderKind } from "@/lib/types";
import { api, errorMessage } from "@/lib/ui/api";
import { relativeTime } from "@/lib/ui/format";
import { loadPlaidLink } from "@/lib/ui/plaid-link";
import {
  FileSpreadsheet,
  KeyRound,
  Link2,
  LogOut,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ConnectionProvider = Exclude<ProviderKind, "manual">;

const credentialFields: Record<
  ConnectionProvider,
  Array<{
    name: string;
    label: string;
    type?: "text" | "password";
    placeholder: string;
    multiline?: boolean;
    options?: Array<{ label: string; value: string }>;
  }>
> = {
  plaid: [
    { name: "clientId", label: "Client ID", placeholder: "Plaid client ID" },
    { name: "secret", label: "Secret", type: "password", placeholder: "Plaid secret" },
    {
      name: "env",
      label: "Environment",
      placeholder: "sandbox",
      options: [
        { label: "Sandbox", value: "sandbox" },
        { label: "Development", value: "development" },
        { label: "Production", value: "production" },
      ],
    },
  ],
  simplefin: [
    {
      name: "setupToken",
      label: "Setup token",
      type: "password",
      placeholder: "Paste your SimpleFIN setup token",
    },
  ],
  teller: [
    { name: "applicationId", label: "Application ID", placeholder: "Teller app ID" },
    {
      name: "certificate",
      label: "Certificate",
      placeholder: "PEM certificate",
      multiline: true,
    },
    {
      name: "privateKey",
      label: "Private key",
      type: "password",
      placeholder: "PEM private key",
      multiline: true,
    },
  ],
};

function providerLabel(provider: ProviderKind) {
  if (provider === "simplefin") return "SimpleFIN";
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

export default function SettingsPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [provider, setProvider] = useState<ConnectionProvider>("plaid");
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [accountId, setAccountId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [workingId, setWorkingId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [plaidWorking, setPlaidWorking] = useState(false);
  const [plaidError, setPlaidError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [connectionResult, accountResult] = await Promise.allSettled([
      api.connections(),
      api.accounts(),
    ]);

    if (connectionResult.status === "fulfilled") {
      setConnections(connectionResult.value);
      setError(null);
    } else {
      setError(errorMessage(connectionResult.reason));
    }
    if (accountResult.status === "fulfilled") {
      setAccounts(accountResult.value.filter((account) => !account.archived));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  function changeProvider(nextProvider: ConnectionProvider) {
    setProvider(nextProvider);
    setCredentials({});
    setNotice(null);
    setError(null);
    setPlaidError(null);
  }

  async function createConnection(event: FormEvent) {
    event.preventDefault();
    if (provider === "plaid") {
      await connectWithPlaid();
      return;
    }

    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const connection = await api.createConnection({ provider, credentials });
      setConnections((current) => [connection, ...current]);
      setCredentials({});
      setNotice(`${providerLabel(provider)} connection added.`);
    } catch (createError) {
      setError(errorMessage(createError));
    } finally {
      setCreating(false);
    }
  }

  async function connectWithPlaid() {
    setPlaidWorking(true);
    setPlaidError(null);
    setError(null);
    setNotice(null);

    try {
      const clientId = credentials.clientId?.trim() ?? "";
      const secret = credentials.secret?.trim() ?? "";
      if (Boolean(clientId) !== Boolean(secret)) {
        throw new Error("Enter both the Plaid client ID and secret, or leave both blank.");
      }

      // Begin downloading in direct response to the click. When new keys were
      // entered, their validation and storage run while the SDK arrives.
      const plaidScript = loadPlaidLink();
      let Plaid: Awaited<typeof plaidScript>;
      if (clientId && secret) {
        const [loadedPlaid, credentialRecord] = await Promise.all([
          plaidScript,
          api.createConnection({
            provider: "plaid",
            credentials: {
              clientId,
              secret,
              env: credentials.env || "sandbox",
            },
          }),
        ]);
        Plaid = loadedPlaid;
        setConnections((current) => [credentialRecord, ...current]);
        setCredentials({});
      } else {
        Plaid = await plaidScript;
      }

      const { linkToken } = await api.plaidLinkToken();

      let completed = false;
      let handler: ReturnType<typeof Plaid.create> | null = null;
      handler = Plaid.create({
        token: linkToken,
        onSuccess(publicToken, metadata) {
          completed = true;
          void (async () => {
            try {
              const connection = await api.exchangePlaidToken({
                publicToken,
                institution: metadata.institution ?? undefined,
              });
              setNotice(
                `${connection.institution ?? "Plaid institution"} connected and initial sync completed.`,
              );
              await load();
            } catch (exchangeError) {
              setPlaidError(errorMessage(exchangeError));
            } finally {
              handler?.destroy();
              setPlaidWorking(false);
            }
          })();
        },
        onExit(linkError) {
          if (completed) return;
          handler?.destroy();
          setPlaidWorking(false);
          if (linkError) {
            setPlaidError(
              linkError.display_message ||
                linkError.error_message ||
                "Plaid Link closed with an error.",
            );
          }
        },
      });
      handler.open();
    } catch (linkError) {
      setPlaidError(errorMessage(linkError));
      setPlaidWorking(false);
    }
  }

  async function syncConnection(connection: Connection) {
    setWorkingId(connection.id);
    setError(null);
    setNotice(null);
    try {
      const result = await api.syncConnection(connection.id);
      setNotice(
        `${providerLabel(connection.provider)} sync finished: ${result.added} added, ${result.modified} updated.`,
      );
      await load();
    } catch (syncError) {
      setError(errorMessage(syncError));
    } finally {
      setWorkingId(null);
    }
  }

  async function deleteConnection(connection: Connection) {
    const confirmed = window.confirm(
      `Delete the ${providerLabel(connection.provider)} connection${connection.institution ? ` for ${connection.institution}` : ""}? Imported financial records are not removed.`,
    );
    if (!confirmed) return;

    setWorkingId(connection.id);
    setError(null);
    setNotice(null);
    try {
      await api.deleteConnection(connection.id);
      setConnections((current) =>
        current.filter((item) => item.id !== connection.id),
      );
      setNotice("Connection deleted. Existing accounts and transactions were kept.");
    } catch (deleteError) {
      setError(errorMessage(deleteError));
    } finally {
      setWorkingId(null);
    }
  }

  async function importCsv(event: FormEvent) {
    event.preventDefault();
    if (!file || !accountId) {
      setError("Choose a CSV file and a destination account.");
      return;
    }

    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.importCsv(file, accountId);
      setNotice(
        `${result.imported} transaction${result.imported === 1 ? "" : "s"} imported.`,
      );
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (importError) {
      setError(errorMessage(importError));
    } finally {
      setImporting(false);
    }
  }

  async function logout() {
    setLoggingOut(true);
    try {
      await api.logout();
      router.replace("/login");
    } catch (logoutError) {
      setError(errorMessage(logoutError));
      setLoggingOut(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Data sources"
        title="Settings"
        description="Bring your own provider credentials. Secrets are sent only to this Moneta instance and encrypted at rest."
        actions={
          <Button variant="secondary" loading={loggingOut} onClick={logout}>
            <LogOut size={15} aria-hidden="true" />
            Sign out
          </Button>
        }
      />

      {notice ? <InlineNotice>{notice}</InlineNotice> : null}
      {error ? <InlineNotice kind="error">{error}</InlineNotice> : null}

      <div className="settings-grid">
        <Surface className="connections-panel">
          <div className="settings-section-heading">
            <div className="settings-icon">
              <Link2 size={18} aria-hidden="true" />
            </div>
            <div>
              <p className="section-kicker">Bank providers</p>
              <h2>Connections</h2>
            </div>
          </div>
          {loading ? (
            <LoadingState label="Checking connections…" />
          ) : connections.length ? (
            <div className="connection-list">
              {connections.map((connection) => (
                <article className="connection-row" key={connection.id}>
                  <div className="provider-mark" aria-hidden="true">
                    {providerLabel(connection.provider).charAt(0)}
                  </div>
                  <div className="connection-copy">
                    <div>
                      <h3>
                        {connection.provider === "plaid" &&
                        !connection.institution &&
                        !connection.lastSyncAt
                          ? "Plaid API credentials"
                          : connection.institution ??
                            providerLabel(connection.provider)}
                      </h3>
                      <StatusDot status={connection.status} />
                    </div>
                    <p>
                      {connection.provider === "plaid" &&
                      !connection.institution &&
                      !connection.lastSyncAt
                        ? "Encrypted locally · Ready to connect a bank"
                        : `${providerLabel(connection.provider)} · Last sync ${relativeTime(connection.lastSyncAt)}`}
                    </p>
                  </div>
                  <div className="connection-actions">
                    {connection.provider === "plaid" &&
                    !connection.institution &&
                    !connection.lastSyncAt ? (
                      <Button
                        variant="secondary"
                        loading={plaidWorking}
                        onClick={connectWithPlaid}
                      >
                        <Link2 size={14} aria-hidden="true" />
                        Connect
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        loading={workingId === connection.id}
                        onClick={() => syncConnection(connection)}
                      >
                        <RefreshCw size={14} aria-hidden="true" />
                        Sync
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      disabled={workingId === connection.id}
                      aria-label={`Delete ${connection.institution ?? providerLabel(connection.provider)} connection`}
                      onClick={() => deleteConnection(connection)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<ServerCog size={22} />}
              title="No providers connected"
              body="Add Plaid, SimpleFIN, or Teller credentials to start syncing accounts."
            />
          )}
        </Surface>

        <Surface className="add-connection-panel">
          <div className="settings-section-heading">
            <div className="settings-icon">
              <KeyRound size={18} aria-hidden="true" />
            </div>
            <div>
              <p className="section-kicker">Bring your own key</p>
              <h2>Add a connection</h2>
            </div>
          </div>
          <form className="settings-form" onSubmit={createConnection}>
            <div className="form-field">
              <label htmlFor="provider">Provider</label>
              <select
                id="provider"
                className="select"
                value={provider}
                onChange={(event) =>
                  changeProvider(event.target.value as ConnectionProvider)
                }
              >
                <option value="plaid">Plaid</option>
                <option value="simplefin">SimpleFIN</option>
                <option value="teller">Teller</option>
              </select>
            </div>
            {credentialFields[provider].map((field) => (
              <div className="form-field" key={field.name}>
                <label htmlFor={`credential-${field.name}`}>{field.label}</label>
                {field.options ? (
                  <select
                    id={`credential-${field.name}`}
                    className="select"
                    value={credentials[field.name] ?? "sandbox"}
                    onChange={(event) =>
                      setCredentials((current) => ({
                        ...current,
                        [field.name]: event.target.value,
                      }))
                    }
                  >
                    {field.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : field.multiline ? (
                  <textarea
                    id={`credential-${field.name}`}
                    className="textarea"
                    required
                    value={credentials[field.name] ?? ""}
                    placeholder={field.placeholder}
                    onChange={(event) =>
                      setCredentials((current) => ({
                        ...current,
                        [field.name]: event.target.value,
                      }))
                    }
                  />
                ) : (
                  <input
                    id={`credential-${field.name}`}
                    className="input"
                    type={field.type ?? "text"}
                    required={provider !== "plaid"}
                    autoComplete="off"
                    value={credentials[field.name] ?? ""}
                    placeholder={field.placeholder}
                    onChange={(event) =>
                      setCredentials((current) => ({
                        ...current,
                        [field.name]: event.target.value,
                      }))
                    }
                  />
                )}
              </div>
            ))}
            {provider === "plaid" && plaidError ? (
              <InlineNotice kind="error">{plaidError}</InlineNotice>
            ) : null}
            <Button
              type="submit"
              loading={provider === "plaid" ? plaidWorking : creating}
            >
              {provider === "plaid"
                ? "Connect with Plaid"
                : `Add ${providerLabel(provider)}`}
            </Button>
            <p className="credential-note">
              <ShieldCheck size={14} aria-hidden="true" />
              {provider === "plaid"
                ? "Enter keys once, or leave them blank to use saved or server environment credentials."
                : "Credentials never pass through a Moneta cloud service."}
            </p>
          </form>
        </Surface>

        <Surface className="import-panel">
          <div className="settings-section-heading">
            <div className="settings-icon">
              <FileSpreadsheet size={18} aria-hidden="true" />
            </div>
            <div>
              <p className="section-kicker">Zero-cost fallback</p>
              <h2>Import transactions from CSV</h2>
            </div>
          </div>
          <div className="import-content">
            <div>
              <h3>Keep the file. Keep the control.</h3>
              <p>
                Export a CSV from your bank, choose its destination account, and
                Moneta will import it locally.
              </p>
            </div>
            <form className="import-form" onSubmit={importCsv}>
              <div className="form-field file-field">
                <label htmlFor="csv-file">CSV file</label>
                <input
                  ref={fileInputRef}
                  id="csv-file"
                  className="input"
                  type="file"
                  accept=".csv,text/csv"
                  required
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                />
              </div>
              <div className="form-field">
                <label htmlFor="import-account">Destination account</label>
                <select
                  id="import-account"
                  className="select"
                  required
                  value={accountId}
                  onChange={(event) => setAccountId(event.target.value)}
                >
                  <option value="">Choose an account</option>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" loading={importing} disabled={!accounts.length}>
                <Upload size={15} aria-hidden="true" />
                Import CSV
              </Button>
            </form>
            {!loading && !accounts.length ? (
              <p className="form-hint">
                A destination account is required before a CSV can be imported.
              </p>
            ) : null}
          </div>
        </Surface>
      </div>
    </div>
  );
}
