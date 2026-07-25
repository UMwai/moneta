import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  LoaderCircle,
  Plus,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className="page-description">{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function Surface({
  children,
  className = "",
  as: Component = "section",
  id,
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "article" | "div";
  id?: string;
}) {
  return <Component id={id} className={`surface ${className}`}>{children}</Component>;
}

export function SectionHeading({
  title,
  label,
  action,
}: {
  title: string;
  label?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        {label ? <p className="section-kicker">{label}</p> : null}
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function Button({
  className = "",
  variant = "primary",
  loading = false,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  loading?: boolean;
}) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`button button-${variant} ${className}`}
    >
      {loading ? (
        <LoaderCircle className="spin" size={16} aria-hidden="true" />
      ) : null}
      {children}
    </button>
  );
}

export function TextLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <Link className="text-link" href={href}>
      {children}
      <ArrowRight size={14} aria-hidden="true" />
    </Link>
  );
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div className="state-panel state-loading" role="status">
      <LoaderCircle className="spin" size={22} aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="state-panel state-error" role="alert">
      <AlertCircle size={22} aria-hidden="true" />
      <div>
        <strong>Couldn&apos;t load this view</strong>
        <span>{message}</span>
      </div>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          <RefreshCw size={15} aria-hidden="true" />
          Retry
        </Button>
      ) : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="state-panel state-empty">
      <div className="empty-icon">{icon ?? <Plus size={22} />}</div>
      <div>
        <strong>{title}</strong>
        <span>{body}</span>
      </div>
      {action}
    </div>
  );
}

export function InlineNotice({
  kind = "success",
  children,
}: {
  kind?: "success" | "error";
  children: ReactNode;
}) {
  return (
    <div className={`inline-notice notice-${kind}`} role="status">
      {kind === "success" ? (
        <CheckCircle2 size={16} aria-hidden="true" />
      ) : (
        <AlertCircle size={16} aria-hidden="true" />
      )}
      {children}
    </div>
  );
}

export function ProgressBar({
  value,
  danger = false,
}: {
  value: number;
  danger?: boolean;
}) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div
      className={`progress-track ${danger ? "progress-danger" : ""}`}
      role="progressbar"
      aria-valuenow={Math.round(clamped)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${clamped}%` }} />
    </div>
  );
}

export function StatusDot({
  status,
}: {
  status: "ok" | "error" | "reauth_required";
}) {
  const label =
    status === "ok"
      ? "Connected"
      : status === "reauth_required"
        ? "Reconnect needed"
        : "Connection error";

  return (
    <span className={`status-pill status-${status}`}>
      <span aria-hidden="true" />
      {label}
    </span>
  );
}
