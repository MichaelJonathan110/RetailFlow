'use client';

import { useRef, useState } from 'react';
import { api, type Batch, type DataSource, type ListResponse } from '@/lib/api';
import { useApi } from '@/components/useApi';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { DataTable, type Column } from '@/components/Table';
import { ErrorState, Loading } from '@/components/States';
import { Provenance } from '@/components/Provenance';
import { formatBytes, formatDateTime, formatNumber, statusTone } from '@/lib/format';

const SUBTITLE =
  'Where data enters RetailFlow: registered sources, their ingestion batches, and validation outcomes.';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || 'http://127.0.0.1:8020/api/v1';

export default function SourcesPage() {
  const sources = useApi<ListResponse<DataSource>>(() => api.get<ListResponse<DataSource>>('/sources'));
  const [selected, setSelected] = useState<number | null>(null);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const list = sources.data?.items ?? [];
  const activeId = selected ?? list[0]?.source_id ?? null;
  const active = list.find((s) => s.source_id === activeId) || null;

  const batches = useApi<ListResponse<Batch>>(
    () =>
      activeId
        ? api.get<ListResponse<Batch>>(`/sources/${activeId}/batches`)
        : Promise.resolve({ items: [] as Batch[] }),
    [activeId],
  );

  async function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setUploadErr('Choose a CSV file first.');
      return;
    }
    setBusy(true);
    setUploadErr(null);
    setUploadMsg(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      if (activeId != null) fd.append('source_id', String(activeId)); // DEMOFIX
      const res = await fetch(`${API_BASE}/ingestion/upload`, { method: 'POST', body: fd });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error?.message || body?.detail || `Upload failed (${res.status})`);
      setUploadMsg(
        `Uploaded ${body?.file_name || file.name} — ${formatNumber(body?.rows_read ?? body?.row_count ?? 0)} rows, ` +
          `${formatNumber(body?.valid_count ?? 0)} valid, ${formatNumber(body?.invalid_count ?? 0)} rejected.`,
      );
      if (fileRef.current) fileRef.current.value = '';
      batches.reload();
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  if (sources.loading && !sources.data) {
    return (
      <>
        <PageHero />
        <Loading label="Loading data sources" />
      </>
    );
  }

  if (sources.error) {
    return (
      <>
        <PageHero />
        <ErrorState message={sources.error} onRetry={sources.reload} />
      </>
    );
  }

  const totalBatches = list.reduce((s, x) => s + (x.batches || 0), 0);
  const datasets = new Set(list.map((x) => x.dataset)).size;
  const activeSources = list.filter((x) => (x.status || '').toLowerCase() === 'active').length;

  const batchCols: Column<Batch>[] = [
    { key: 'batch_id', header: 'Batch', render: (b) => <code className="rf-mono">{b.batch_id.slice(0, 12)}</code> },
    { key: 'file_name', header: 'File', render: (b) => b.file_name },
    { key: 'status', header: 'Status', render: (b) => <Badge tone={statusTone(b.status)}>{b.status}</Badge> },
    { key: 'rows', header: 'Rows', align: 'right', render: (b) => formatNumber(b.row_count) },
    { key: 'valid', header: 'Valid', align: 'right', render: (b) => formatNumber(b.valid_count) },
    {
      key: 'invalid',
      header: 'Rejected',
      align: 'right',
      render: (b) => (
        <span style={{ color: b.invalid_count ? 'var(--rf-danger, #B4553F)' : undefined }}>
          {formatNumber(b.invalid_count)}
        </span>
      ),
    },
    { key: 'size', header: 'Size', align: 'right', render: (b) => formatBytes(b.size_bytes) },
    { key: 'received', header: 'Received', render: (b) => formatDateTime(b.received_at) },
  ];

  return (
    <>
      <PageHero />

      <div className="rf-kpi-grid rf-stagger">
        <div className="rf-kpi-card" data-tone="blue">
          <span className="rf-kpi-label">Registered sources</span>
          <span className="rf-kpi-value">{formatNumber(list.length)}</span>
          <span className="rf-kpi-meta">{formatNumber(activeSources)} active</span>
        </div>
        <div className="rf-kpi-card" data-tone="green">
          <span className="rf-kpi-label">Batches received</span>
          <span className="rf-kpi-value">{formatNumber(totalBatches)}</span>
          <span className="rf-kpi-meta">Across all sources</span>
        </div>
        <div className="rf-kpi-card" data-tone="lavender">
          <span className="rf-kpi-label">Datasets</span>
          <span className="rf-kpi-value">{formatNumber(datasets)}</span>
          <span className="rf-kpi-meta">Distinct targets</span>
        </div>
        <div className="rf-kpi-card" data-tone="butter">
          <span className="rf-kpi-label">Selected source</span>
          <span className="rf-kpi-value" style={{ fontSize: 20 }}>
            {active ? active.name : '—'}
          </span>
          <span className="rf-kpi-meta">{active ? formatNumber(active.batches) + ' batches' : 'Pick a source'}</span>
        </div>
      </div>

      <section className="rf-section">
        <h2 className="rf-section-title">Sources</h2>
        {list.length === 0 ? (
          <div className="rf-panel">
            <p className="rf-panel-sub">No data sources are registered yet.</p>
          </div>
        ) : (
          <div className="rf-grid-3">
            {list.map((s) => {
              const on = s.source_id === activeId;
              return (
                <button
                  key={s.source_id}
                  type="button"
                  className="rf-source-card"
                  data-active={on}
                  onClick={() => setSelected(s.source_id)}
                >
                  <div className="rf-source-top">
                    <span className="rf-source-name">{s.name}</span>
                    <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                  </div>
                  <div className="rf-source-meta">
                    <Badge tone="info">{s.source_type}</Badge>
                    <span className="rf-muted">{s.dataset}</span>
                  </div>
                  {s.description && <p className="rf-source-desc">{s.description}</p>}
                  <div className="rf-source-foot">
                    <span>{formatNumber(s.batches)} batches</span>
                    {s.location_hint && <span className="rf-muted rf-ellipsis">{s.location_hint}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="rf-section">
        <h2 className="rf-section-title">Ingestion history</h2>
        <Card
          title={active ? `${active.name} — batches` : 'Batches'}
          subtitle={active ? `Source ${active.source_id} · ${active.dataset}` : 'Select a source to inspect its batches.'}
          action={
            <button className="rf-btn rf-btn-ghost" onClick={batches.reload} disabled={!activeId}>
              Refresh
            </button>
          }
        >
          {batches.loading && !batches.data ? (
            <Loading label="Loading batches" />
          ) : batches.error ? (
            <ErrorState message={batches.error} onRetry={batches.reload} />
          ) : (
            <DataTable<Batch>
              columns={batchCols}
              rows={batches.data?.items ?? []}
              emptyLabel="No batches for this source yet."
              emptyHint="Upload a CSV to create the first batch."
            />
          )}
        </Card>
        <Provenance source="GET /sources · /sources/{id}/batches" updatedAt={null} note="Live metadata from the RetailFlow API." />
      </section>

      <section className="rf-section">
        <h2 className="rf-section-title">Upload a CSV</h2>
        <div className="rf-panel">
          <div className="rf-panel-head">
            <div>
              <h3 className="rf-panel-title">Ingest a new file</h3>
              <p className="rf-panel-sub">
                The file is validated against the dataset rules; rejected rows are quarantined with reasons.
              </p>
            </div>
          </div>
          <form onSubmit={onUpload} className="rf-upload">
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="rf-file" aria-label="CSV file" />
            <button className="rf-btn" type="submit" disabled={busy}>
              {busy ? 'Uploading…' : 'Upload & validate'}
            </button>
          </form>
          {uploadMsg && <p className="rf-note rf-note-ok">{uploadMsg}</p>}
          {uploadErr && <p className="rf-note rf-note-err">{uploadErr}</p>}
        </div>
      </section>
    </>
  );
}

function PageHero() {
  return (
    <header className="rf-hero rf-rise">
      <p className="rf-eyebrow">Ingestion</p>
      <h1 className="rf-display">Data sources</h1>
      <p className="rf-lede">{SUBTITLE}</p>
    </header>
  );
}
