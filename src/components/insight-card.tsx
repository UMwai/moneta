import type { Insight } from "@/lib/types";
import { formatDate } from "@/lib/ui/format";
import { ArrowUpRight, CircleAlert, Lightbulb, ShieldAlert, X } from "lucide-react";
import { Button } from "./ui";

const icons = {
  info: Lightbulb,
  warn: CircleAlert,
  critical: ShieldAlert,
};

export function InsightCard({
  insight,
  onDismiss,
  dismissing = false,
}: {
  insight: Insight;
  onDismiss: (id: string) => void;
  dismissing?: boolean;
}) {
  const Icon = icons[insight.severity];

  return (
    <article className={`insight-card insight-${insight.severity}`}>
      <div className="insight-icon">
        <Icon size={19} aria-hidden="true" />
      </div>
      <div className="insight-content">
        <div className="insight-meta">
          <span>{insight.kind.replaceAll("_", " ")}</span>
          <time dateTime={insight.createdAt}>{formatDate(insight.createdAt)}</time>
        </div>
        <h3>{insight.title}</h3>
        <p>{insight.body}</p>
        {insight.action ? (
          <div className="insight-action">
            <ArrowUpRight size={15} aria-hidden="true" />
            {insight.action}
          </div>
        ) : null}
      </div>
      <Button
        variant="ghost"
        className="dismiss-button"
        onClick={() => onDismiss(insight.id)}
        loading={dismissing}
        aria-label={`Dismiss ${insight.title}`}
        title="Dismiss insight"
      >
        {dismissing ? null : <X size={17} aria-hidden="true" />}
      </Button>
    </article>
  );
}
