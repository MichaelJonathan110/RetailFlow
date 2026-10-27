'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useApi } from '@/components/useApi';
import { Card } from '@/components/Card';
import { ErrorState, Loading } from '@/components/States';
import { PageHeader } from '@/components/PageHeader';
import { Provenance } from '@/components/Provenance';
import { formatNumber } from '@/lib/format';

interface Alert {
  rule_code: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  subject: string;
  occurred_at: string | null;
  metric: number | null;
  link: string;
}

interface AlertsResponse {
  items: Alert[];
  total: number;
  counts: Record<string, number>;
}

interface Rule {
  code: string;
  name: string;
  severity: string;
  threshold: string;
  source: string;
}

const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

function when(ts: string | null): string {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts);
  return d.toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}

export default function AlertsPage() {
  const alerts = useApi<AlertsResponse>(() => api.get<AlertsResponse>('/alerts'));
  const rules = useApi<{ items: Rule[] }>(() => api.get<{ items: Rule[] }>('/alerts/rules'));
  const [filter, setFilter] = useState<string>('all');
  // DEMOFIX418: timestamp set in the browser only, so server and client HTML match.
  const [checkedAt, setCheckedAt] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (alerts.data) setCheckedAt(new Date().toISOString());
  }, [alerts.data]);

  const items = alerts.data?.items ?? [];
  const counts = alerts.data?.counts ?? {};
  const shown = useMemo(
    () => (filter === 'all' ? items : items.filter((a) => a.severity === filter)),
    [items, filter],
  );

  return (
    <>
      <PageHeader
        title="Alert Center"
        subtitle="Operational alerts derived from real pipeline, quality, reconciliation and ingestion events."
        action={<button className="rf-btn" onClick={alerts.reload}>Refresh</button>}
        source="ops.etl_run_log, ops.data_quality_results, ops.etl_rejects, ops.ingest_batch"
        updatedAt={checkedAt}
        demo
      />

      {alerts.loading && !alerts.data ? (
        <Loading label="Evaluating alert rules…" />
      ) : alerts.error ? (
        <ErrorState message={alerts.error} onRetry={alerts.reload} />
      ) : (
        <>
          <div className="rf-grid rf-grid-4 rf-stagger">
            {SEVERITIES.map((s) => (
              <div className="rf-card rf-kpi" key={s}>
                <span className="rf-kpi-label">{s}</span>
                <span className="rf-kpi-value">{formatNumber(counts[s] ?? 0)}</span>
                <span className="rf-kpi-meta">open alert{(counts[s] ?? 0) === 1 ? '' : 's'}</span>
              </div>
            ))}
          </div>

          <div className="rf-section" style={{ marginTop: 16 }}>
            <div className="rf-inline" style={{ gap: 8, marginBottom: 10 }}>
              <div className="rf-seg" role="group" aria-label="Severity filter">
                {(['all', ...SEVERITIES] as const).map((s) => (
                  <button key={s} type="button" aria-pressed={filter === s} onClick={() => setFilter(s)}>
                    {s === 'all' ? `All (${items.length})` : s}
                  </button>
                ))}
              </div>
            </div>

            {shown.length === 0 ? (
              <Card title="No alerts">
                <p className="rf-note">
                  No rule is currently breached. Alerts appear here the moment a run fails, a
                  quality rule is violated, or a reject rate crosses tolerance.
                </p>
              </Card>
            ) : (
              <div className="rf-grid rf-grid-2 rf-stagger">
                {shown.map((a, i) => (
                  <div className="rf-card" key={`${a.rule_code}-${i}`}>
                    <div className="rf-inline" style={{ justifyContent: 'space-between', gap: 8 }}>
                      <span className="rf-badge" data-tone={a.severity === 'critical' || a.severity === 'high' ? 'danger' : 'warn'}>
                        {a.severity}
                      </span>
                      <span className="rf-mono" style={{ fontSize: 11 }}>{a.rule_code}</span>
                    </div>
                    <div className="rf-card-title" style={{ marginTop: 8 }}>{a.title}</div>
                    <p className="rf-note" style={{ marginTop: 4 }}>{a.detail}</p>
                    <div className="rf-dl" style={{ marginTop: 8 }}>
                      <div className="rf-dl-row">
                        <span className="rf-dl-key">Occurred</span>
                        <span className="rf-dl-val rf-mono">{when(a.occurred_at)}</span>
                      </div>
                      {a.metric !== null && (
                        <div className="rf-dl-row">
                          <span className="rf-dl-key">Metric</span>
                          <span className="rf-dl-val rf-num">{formatNumber(a.metric)}</span>
                        </div>
                      )}
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <Link href={a.link} className="rf-btn" data-variant="ghost">Investigate</Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <section className="rf-section">
            <h2 className="rf-section-title">Rule catalogue</h2>
            <Card title="What is monitored" subtitle="Thresholds are explicit and read straight from the warehouse.">
              {rules.data && (
                <div className="rf-dl">
                  {rules.data.items.map((r) => (
                    <div className="rf-dl-row" key={r.code}>
                      <span className="rf-dl-key rf-mono">{r.code}</span>
                      <span className="rf-dl-val">
                        {r.name} — <em>{r.threshold}</em> <span className="rf-mono">({r.source})</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
            <Provenance source="GET /alerts, GET /alerts/rules" demo note="Alerts are computed on request from live operational tables — nothing is cached or simulated." />
          </section>
        </>
      )}
    </>
  );
}
