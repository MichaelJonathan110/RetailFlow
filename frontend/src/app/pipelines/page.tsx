'use client';

import { useState } from 'react';
import { api, ApiError, type ListResponse, type Pipeline, type PipelineDetail, type RunDetail } from '@/lib/api';
import { useApi } from '@/components/useApi';
import { Badge } from '@/components/Badge';
import { Card, Kpi } from '@/components/Card';
import { DataTable, type Column } from '@/components/Table';
import { ErrorState, Loading } from '@/components/States';
import { Provenance } from '@/components/Provenance';
import { formatDateTime, formatDuration, formatNumber, statusTone } from '@/lib/format';

const SUBTITLE =
  'Orchestration view: how each pipeline is staged, when it last ran, and what it produced.';

export default function PipelinesPage() {
  const pipelines = useApi<ListResponse<Pipeline>>(() => api.get<ListResponse<Pipeline>>('/pipelines'));
  const [selected, setSelected] = useState<number | null>(null);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [runErr, setRunErr] = useState<string | null>(null);

  const list = pipelines.data?.items ?? [];
  const activeId = selected ?? list[0]?.pipeline_id ?? null;

  const detail = useApi<PipelineDetail | null>(
    () => (activeId ? api.get<PipelineDetail>(`/pipelines/${activeId}`) : Promise.resolve(null)),
    [activeId],
  );
  const runs = useApi<ListResponse<RunDetail>>(
    () => (activeId ? api.get<ListResponse<RunDetail>>(`/pipelines/${activeId}/runs`) : Promise.resolve({ items: [] })),
    [activeId],
  );

  async function runNow() {
    if (!activeId) return;
    setRunning(true);
    setRunErr(null);
    setRunMsg(null);
    try {
      const res = await api.post<RunDetail>(`/pipelines/${activeId}/run`);
      setRunMsg(
        `Run ${res?.run_id ? res.run_id.slice(0, 12) : 'started'} — status ${res?.status || 'queued'}.`,
      );
      runs.reload();
      pipelines.reload();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'Could not start the run.';
      setRunErr(msg);
    } finally {
      setRunning(false);
    }
  }

  if (pipelines.loading && !pipelines.data) {
    return (
      <>
        <PageHero />
        <Loading label="Loading pipelines" />
      </>
    );
  }
  if (pipelines.error) {
    return (
      <>
        <PageHero />
        <ErrorState message={pipelines.error} onRetry={pipelines.reload} />
      </>
    );
  }

  const active = list.find((p) => p.pipeline_id === activeId) || null;
  const stages = detail.data?.stages ?? [];

  const runCols: Column<RunDetail>[] = [
    { key: 'run_id', header: 'Run', render: (r) => <code className="rf-mono">{r.run_id.slice(0, 12)}</code> },
    { key: 'status', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
    { key: 'started', header: 'Started', render: (r) => formatDateTime(r.started_at) },
    { key: 'dur', header: 'Duration', align: 'right', render: (r) => formatDuration(r.duration_ms) },
    { key: 'read', header: 'Read', align: 'right', render: (r) => formatNumber(r.rows_read ?? 0) },
    { key: 'loaded', header: 'Loaded', align: 'right', render: (r) => formatNumber(r.rows_loaded ?? 0) },
    {
      key: 'rejected',
      header: 'Rejected',
      align: 'right',
      render: (r) => (
        <span style={{ color: r.rows_rejected ? 'var(--rf-danger, #B4553F)' : undefined }}>
          {formatNumber(r.rows_rejected ?? 0)}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHero />

      <div className="rf-kpi-grid rf-stagger">
        <div className="rf-kpi-card" data-tone="blue">
          <span className="rf-kpi-label">Pipelines</span>
          <span className="rf-kpi-value">{formatNumber(list.length)}</span>
          <span className="rf-kpi-meta">{list.filter((p) => p.is_active).length} active</span>
        </div>
        <div className="rf-kpi-card" data-tone="green">
          <span className="rf-kpi-label">Executable</span>
          <span className="rf-kpi-value">{formatNumber(list.filter((p) => p.is_executable).length)}</span>
          <span className="rf-kpi-meta">Ready to run now</span>
        </div>
        <div className="rf-kpi-card" data-tone="lavender">
          <span className="rf-kpi-label">Total runs</span>
          <span className="rf-kpi-value">{formatNumber(list.reduce((s, p) => s + (p.runs || 0), 0))}</span>
          <span className="rf-kpi-meta">Across all pipelines</span>
        </div>
        <div className="rf-kpi-card" data-tone="butter">
          <span className="rf-kpi-label">Stages</span>
          <span className="rf-kpi-value">{formatNumber(list.reduce((s, p) => s + (p.stages || 0), 0))}</span>
          <span className="rf-kpi-meta">Declared steps</span>
        </div>
      </div>

      <section className="rf-section">
        <h2 className="rf-section-title">Pipelines</h2>
        <div className="rf-grid-3">
          {list.map((p) => {
            const on = p.pipeline_id === activeId;
            return (
              <button
                key={p.pipeline_id}
                type="button"
                className="rf-source-card"
                data-active={on}
                onClick={() => setSelected(p.pipeline_id)}
              >
                <div className="rf-source-top">
                  <span className="rf-source-name">{p.name}</span>
                  <Badge tone={p.is_active ? 'success' : 'neutral'}>{p.is_active ? 'active' : 'paused'}</Badge>
                </div>
                <div className="rf-source-meta">
                  <Badge tone="info">{p.pipeline_type}</Badge>
                  <span className="rf-muted">{p.engine}</span>
                </div>
                {p.description && <p className="rf-source-desc">{p.description}</p>}
                <div className="rf-source-foot">
                  <span>{formatNumber(p.stages)} stages</span>
                  <span className="rf-muted">{p.last_run_at ? formatDateTime(p.last_run_at) : 'never run'}</span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {active && (
        <section className="rf-section">
          <h2 className="rf-section-title">Stage flow — {active.name}</h2>
          <div className="rf-panel">
            <div className="rf-panel-head">
              <div>
                <h3 className="rf-panel-title">{active.name}</h3>
                <p className="rf-panel-sub">
                  {active.target_table ? `Loads into ${active.target_table} · ` : ''}
                  {active.engine}
                </p>
              </div>
              <div className="rf-toolbar-inline">
                <button className="rf-btn" onClick={runNow} disabled={running || !active.is_executable}>
                  {running ? 'Starting…' : active.is_executable ? 'Run now' : 'Not executable'}
                </button>
              </div>
            </div>
            {runMsg && <p className="rf-note rf-note-ok">{runMsg}</p>}
            {runErr && <p className="rf-note rf-note-err">{runErr}</p>}
            {detail.loading && !detail.data ? (
              <Loading label="Loading stages" />
            ) : stages.length === 0 ? (
              <p className="rf-panel-sub">This pipeline declares no stages.</p>
            ) : (
              <ol className="rf-flow">
                {stages.map((st, i) => (
                  <li className="rf-flow-node" key={st.stage_id} data-active={st.is_active}>
                    <span className="rf-flow-index">{i + 1}</span>
                    <div className="rf-flow-body">
                      <span className="rf-flow-name">{st.stage_name}</span>
                      <span className="rf-flow-kind">{st.stage_kind}</span>
                      {st.description && <p className="rf-flow-desc">{st.description}</p>}
                    </div>
                    <Badge tone={st.is_active ? 'success' : 'neutral'}>{st.is_active ? 'on' : 'off'}</Badge>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      )}

      <section className="rf-section">
        <h2 className="rf-section-title">Execution history</h2>
        <Card
          title={active ? `${active.name} — recent runs` : 'Runs'}
          action={
            <button className="rf-btn" data-variant="ghost" onClick={runs.reload} disabled={!activeId}>
              Refresh
            </button>
          }
        >
          {runs.loading && !runs.data ? (
            <Loading label="Loading runs" />
          ) : runs.error ? (
            <ErrorState message={runs.error} onRetry={runs.reload} />
          ) : (
            <DataTable<RunDetail>
              columns={runCols}
              rows={runs.data?.items ?? []}
              emptyLabel="No runs recorded for this pipeline yet."
              emptyHint="Use Run now to trigger the first execution."
            />
          )}
        </Card>
        <Provenance source="GET /pipelines · /pipelines/{id} · /pipelines/{id}/runs" updatedAt={null} note="Live ETL orchestration metadata." />
      </section>
    </>
  );
}

function PageHero() {
  return (
    <header className="rf-hero rf-rise">
      <p className="rf-eyebrow">ETL</p>
      <h1 className="rf-display">Pipelines</h1>
      <p className="rf-lede">{SUBTITLE}</p>
    </header>
  );
}
