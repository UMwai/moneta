"use client";

import { InsightCard } from "@/components/insight-card";
import {
  EmptyState,
  ErrorState,
  InlineNotice,
  LoadingState,
  PageHeader,
  Surface,
} from "@/components/ui";
import type { Insight } from "@/lib/types";
import { api, errorMessage } from "@/lib/ui/api";
import { formatMonth } from "@/lib/ui/format";
import { CircleAlert, Lightbulb, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

export default function InsightsPage() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await api.insights();
      setInsights(result.filter((insight) => !insight.dismissed));
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

  const groups = useMemo(() => {
    const byPeriod = new Map<string, Insight[]>();
    insights.forEach((insight) => {
      byPeriod.set(insight.period, [...(byPeriod.get(insight.period) ?? []), insight]);
    });
    return [...byPeriod.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [insights]);

  const counts = {
    critical: insights.filter((insight) => insight.severity === "critical").length,
    warn: insights.filter((insight) => insight.severity === "warn").length,
    info: insights.filter((insight) => insight.severity === "info").length,
  };

  async function dismiss(id: string) {
    setDismissing(id);
    setError(null);
    setNotice(null);
    try {
      await api.dismissInsight(id);
      setInsights((current) => current.filter((insight) => insight.id !== id));
      setNotice("Insight dismissed.");
    } catch (dismissError) {
      setError(errorMessage(dismissError));
    } finally {
      setDismissing(null);
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Action feed"
        title="Insights"
        description="Rule-based observations from your own data. Nothing is sold, shared, or used to train a model."
      />

      {!loading && insights.length ? (
        <div className="insight-counts">
          <Surface>
            <span className="count-icon count-critical">
              <ShieldAlert size={17} />
            </span>
            <div>
              <strong>{counts.critical}</strong>
              <span>Critical</span>
            </div>
          </Surface>
          <Surface>
            <span className="count-icon count-warn">
              <CircleAlert size={17} />
            </span>
            <div>
              <strong>{counts.warn}</strong>
              <span>Watch</span>
            </div>
          </Surface>
          <Surface>
            <span className="count-icon count-info">
              <Lightbulb size={17} />
            </span>
            <div>
              <strong>{counts.info}</strong>
              <span>Informational</span>
            </div>
          </Surface>
        </div>
      ) : null}

      {notice ? <InlineNotice>{notice}</InlineNotice> : null}
      {error && insights.length ? (
        <InlineNotice kind="error">{error}</InlineNotice>
      ) : null}

      {loading ? (
        <Surface>
          <LoadingState label="Reviewing your financial patterns…" />
        </Surface>
      ) : error && !insights.length ? (
        <Surface>
          <ErrorState message={error} onRetry={retry} />
        </Surface>
      ) : groups.length ? (
        <div className="insight-groups">
          {groups.map(([period, periodInsights]) => (
            <Surface key={period}>
              <div className="insight-period-heading">
                <div>
                  <p className="section-kicker">Statement period</p>
                  <h2>{formatMonth(period)}</h2>
                </div>
                <span>{periodInsights.length} open</span>
              </div>
              {periodInsights.map((insight) => (
                <InsightCard
                  key={insight.id}
                  insight={insight}
                  dismissing={dismissing === insight.id}
                  onDismiss={dismiss}
                />
              ))}
            </Surface>
          ))}
        </div>
      ) : (
        <Surface>
          <EmptyState
            icon={<Lightbulb size={22} />}
            title="You’re all caught up"
            body="New insights will appear as Moneta sees enough transaction history to make an observation useful."
          />
        </Surface>
      )}
    </div>
  );
}
