'use client';

import { useState } from 'react';
import { api, type ListResponse, type RunDetail, type RunSummary } from '@/lib/api';
import { useApi } from '@/components/useApi';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { DataTable, type Column } from '@/components/Table';
import { ErrorState, Loading } from '@/components/States';
import { Provenance } from '@/components/Provenance';
import { formatCompact, formatDateTime, formatDuration, formatNumber, statusTone } from '@/lib/format';

const SUBTITLE =
  'Every ETL execution, its timing, throughput and the rows it could not load — with failure detail on demand.';

const FILTERS = ['all', 'success', 'failed', 'running'] as const;

export default function MonitoringPage() {
  const [status, setStatus] = useState<string>('all');
  const [selected, setSelected] = useState<string | null>(null);

  const runs = useApi<ListResponse<RunSummary>>(
    () => api.get<ListResponse<RunSummary>>(`/runs?limit=50${status !== 'all' ? `&status=${status}` : ''}`),
    [status],
  );
  const summary = useApi<Record<string, number>>(() => api.get<Record<string, number>>('/monitoring/summary'));
  const detail = useApi<RunDetail | null>(
    () => (selected ? api.get<RunDetail>(`/runs/${selected}`) : Promise.resolve(null)),
    [selected],
  );

  const items = runs.data?.items ?? [];
  const s = summary.data || {};

  const cols: Column<RunSummary>[] = [
    { key: 'run_id', header: 'Run', render: (r) => <code className="rf-mono">{r.run_id.slice(0, 12)}</code> },
    { key: 'pipeline', header: 'Pipeline', render: (r) => r.pipeline_name || '—' },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
    { key: 'started', header: 'Started', render: (r) => formatDateTime(r.started_at) },
    { key: 'dur', header: 'Duration', align: 'right', render: (r) => formatDuration(r.duration_ms) },
    { key: 'read', header: 'Read', align: 'right', render: (r) => formatCompact(r.rows_read ?? 0) },
    { key: 'loaded', header: 'Loaded', align: 'right', render: (r) => formatCompact(r.rows_loaded ?? 0) },
    {
      key: 'rejected',
      header: 'Rejected',
      align: 'right',
      render: (r) => (
        <span style={{ color: r.rows_rejected ? 'var(--rf-danger, #B4553F)' : undefined }}>
          {formatCompact(r.rows_rejected ?? 0)}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHero />

      <div className="rf-kpi-grid rf-stagger">
        <div className="rf-kpi-card" data-tone="blue">
          <span className="rf-kpi-label">Total runs</span>
          <span className="rf-kpi-value">{formatCompact(s.total_runs ?? items.length)}</span>
          <span className="rf-kpi-meta">Recorded executions</span>
        </div>
        <div className="rf-kpi-card" data-tone="green">
          <span className="rf-kpi-label">Succeeded</span>
          <span className="rf-kpi-value">{formatCompact(s.succeeded ?? 0)}</span>
          <span className="rf-kpi-meta">Completed without error</span>
        </div>
        <div className="rf-kpi-card" data-tone="butter">
          <span className="rf-kpi-label">Failed</span>
          <span className="rf-kpi-value">{formatCompact(s.failed ?? 0)}</span>
          <span className="rf-kpi-meta">Needs attention</span>
        </div>
        <div className="rf-kpi-card" data-tone="lavender">
          <span className="rf-kpi-label">Running</span>
          <span className="rf-kpi-value">{formatCompact(s.running ?? 0)}</span>
          <span className="rf-kpi-meta">In flight now</span>
        </div>
      </div>

      <section className="rf-section">
        <div className="rf-panel-head">
          <h2 className="rf-section-title" style={{ margin: 0 }}>Run history</h2>
          <div className="rf-seg" role="group" aria-label="Status filter">
            {FILTERS.map((f) => (
              <button key={f} data-active={status === f} onClick={() => setStatus(f)}>
                {f}
              </button>
            ))}
          </div>
        </div>
        <Card
          title="Executions"
          subtitle={status === 'all' ? 'Most recent 50 runs' : `Filtered: ${status}`}
          action={
            <button className="rf-btn" data-variant="ghost" onClick={runs.reload}>
              Refresh
            </button>
          }
        >
          {runs.loading && !runs.data ? (
            <Loading label="Loading runs" />
          ) : runs.error ? (
            <ErrorState message={runs.error} onRetry={runs.reload} />
          ) : (
            <DataTable<RunSummary>
              columns={cols}
              rows={items}
              emptyLabel="No runs match this filter."
              emptyHint="Try a different status."
            />
          )}
        </Card>
        <div className="rf-toolbar-inline" style={{ marginTop: 12 }}>
          <span className="rf-muted" style={{ fontSize: 12 }}>Select a run to inspect its stages and logs.</span>
          <select
            className="rf-select"
            value={selected ?? ''}
            onChange={(e) => setSelected(e.target.value || null)}
            aria-label="Select run"
          >
            <option value="">— choose a run —</option>
            {items.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                {r.run_id.slice(0, 12)} · {r.pipeline_name || 'run'} · {r.status}
              </option>
            ))}
          </select>
        </div>
        <Provenance source="GET /runs · /monitoring/summary · /runs/{id}" updatedAt={null} note="Live ETL execution log." />
      </section>

      {selected && (
        <section className="rf-section">
          <h2 className="rf-section-title">Run detail</h2>
          <Card
            title={`Run ${selected.slice(0, 12)}`}
            subtitle={detail.data ? `${detail.data.pipeline_name || 'pipeline'} · ${detail.data.status}` : 'Loading…'}
          >
            {detail.loading && !detail.data ? (
              <Loading label="Loading run detail" />
            ) : detail.error ? (
              <ErrorState message={detail.error} onRetry={detail.reload} />
            ) : detail.data ? (
              <>
                {detail.data.error_message && (
                  <p className="rf-note rf-note-err">{detail.data.error_message}</p>
                )}
                {detail.data.stages?.length ? (
                  <div className="rf-table-wrap">
                    <table className="rf-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Stage</th>
                          <th>Status</th>
                          <th className="rf-num">In</th>
                          <th className="rf-num">Out</th>
                          <th className="rf-num">Duration</th>
                          <th>Message</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.data.stages.map((st) => (
                          <tr key={st.stage_order}>
                            <td>{st.stage_order}</td>
                            <td>{st.stage_name}</td>
                            <td><Badge tone={statusTone(st.status)}>{st.status}</Badge></td>
                            <td className="rf-num">{formatNumber(st.rows_in ?? 0)}</td>
                            <td className="rf-num">{formatNumber(st.rows_out ?? 0)}</td>
                            <td className="rf-num">{formatDuration(st.duration_ms)}</td>
                            <td>{st.message || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="rf-panel-sub">No stage-level detail was recorded for this run.</p>
                )}
                {detail.data.log_output && (
                  <details className="rf-details" style={{ marginTop: 14 }}>
                    <summary>Log output</summary>
                    <pre className="rf-log">{detail.data.log_output}</pre>
                  </details>
                )}
              </>
            ) : null}
          </Card>
        </section>
      )}
    </>
  );
}

function PageHero() {
  return (
    <header className="rf-hero rf-rise">
      <p className="rf-eyebrow">Operations</p>
      <h1 className="rf-display">ETL monitoring</h1>
      <p className="rf-lede">{SUBTITLE}</p>
    </header>
  );
}
