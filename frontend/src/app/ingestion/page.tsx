'use client';

import { useRef, useState } from 'react';
import { api, API_BASE, ApiError, type Batch, type ListResponse } from '@/lib/api';
import { useApi } from '@/components/useApi';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { DataTable } from '@/components/Table';
import { ErrorState, Loading } from '@/components/States';
import { PageHeader } from '@/components/PageHeader';
import { Provenance } from '@/components/Provenance';
import { formatBytes, formatDateTime, formatNumber, statusTone } from '@/lib/format';

interface DatasetInfo {
  dataset: string;
  columns: string[];
  target_table: string;
}

interface DatasetsResponse {
  items: DatasetInfo[];
  limits: { max_upload_mb: number; max_rows: number };
}

interface UploadResult {
  batch_id: string;
  dataset: string;
  file_name: string;
  rows_read: number;
  rows_staged: number;
  rows_invalid: number;
  status: string;
  duration_ms: number;
  idempotent_replay: boolean;
  message?: string;
}

export default function IngestionPage() {
  const datasets = useApi<DatasetsResponse>(() => api.get<DatasetsResponse>('/ingestion/datasets'));
  const batches = useApi<ListResponse<Batch>>(() => api.get<ListResponse<Batch>>('/ingestion/batches'));
  const [dataset, setDataset] = useState('order_items');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const active = datasets.data?.items.find((d) => d.dataset === dataset);

  async function upload() {
    if (!file) {
      setError('Choose a CSV file first.');
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('dataset', dataset);
      const response = await fetch(`${API_BASE}/ingestion/upload`, { method: 'POST', body: form });
      const body = await response.json();
      if (!response.ok) {
        throw new ApiError(body?.error?.message || 'Upload failed', body?.error?.code || 'upload_failed', response.status, body?.error?.details);
      }
      setResult(body as UploadResult);
      setFile(null);
      if (inputRef.current) inputRef.current.value = '';
      batches.reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Data Ingestion"
        subtitle="Upload source CSVs. Every row is staged raw, validated against the active rules, and any failures are quarantined with a reason."
      />

      <div className="rf-grid rf-grid-2" style={{ marginBottom: 14 }}>
        <Card title="Upload a source file" subtitle="CSV only. The file is validated before anything is staged.">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 11.5, color: 'var(--rf-text-muted)' }}>Dataset</span>
              <select className="rf-select" value={dataset} onChange={(e) => setDataset(e.target.value)}>
                {datasets.data?.items.map((d) => (
                  <option key={d.dataset} value={d.dataset}>{d.dataset} → {d.target_table}</option>
                ))}
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <span style={{ fontSize: 11.5, color: 'var(--rf-text-muted)' }}>CSV file</span>
              <input ref={inputRef} className="rf-input" type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </label>

            <button className="rf-btn" data-variant="primary" disabled={busy || !file} onClick={upload} style={{ alignSelf: 'flex-start' }}>
              {busy ? 'Uploading and validating...' : 'Upload and validate'}
            </button>

            {active && (
              <div style={{ fontSize: 11.5, color: 'var(--rf-text-dim)' }}>
                Expected columns: <span className="rf-mono">{active.columns.join(', ')}</span>
                {datasets.data && (
                  <> · Limits: {datasets.data.limits.max_upload_mb} MB / {formatNumber(datasets.data.limits.max_rows)} rows</>
                )}
              </div>
            )}
          </div>

          {error && <div className="rf-alert" data-tone="danger" style={{ marginTop: 12 }}>{error}</div>}

          {result && (
            <div className="rf-alert" data-tone={result.rows_invalid > 0 ? 'warning' : 'info'} style={{ marginTop: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 5 }}>
                {result.idempotent_replay ? 'Identical file already ingested' : `Batch ${result.batch_id.slice(0, 8)} ${result.status}`}
              </div>
              <div>Read {formatNumber(result.rows_read)} · staged {formatNumber(result.rows_staged)} · invalid {formatNumber(result.rows_invalid)} · {result.duration_ms} ms</div>
              {result.message && <div style={{ marginTop: 4 }}>{result.message}</div>}
            </div>
          )}

          <Provenance source="POST /api/v1/ingestion/upload" note="Rows are written to staging.stg_* with the raw payload preserved; rejects go to ops.etl_rejects." />
        </Card>

        <Card title="How ingestion works" subtitle="The path from file to warehouse">
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.9, color: 'var(--rf-text-muted)' }}>
            <li>Header names are normalised, so <span className="rf-mono">order_purchase_timestamp</span> and <span className="rf-mono">purchase_ts</span> both resolve.</li>
            <li>The whole file is streamed row by row — memory stays flat on large uploads.</li>
            <li>Every row lands in staging as text with its original payload, so nothing is lost.</li>
            <li>Active data-quality rules run per row; failures are recorded as rejected records with a reason.</li>
            <li>The SHA-256 of the upload makes re-uploading the same file idempotent.</li>
            <li>Dimensions and facts are loaded separately by the pipelines, from validated rows only.</li>
          </ol>
        </Card>
      </div>

      <Card title="Ingestion batches" subtitle="Every upload, with its validation outcome">
        {batches.loading && <Loading />}
        {batches.error && <ErrorState message={batches.error} onRetry={batches.reload} />}
        {batches.data && (
          <DataTable
            columns={[
              { key: 'b', header: 'Batch', render: (b) => <span className="rf-mono">{b.batch_id.slice(0, 8)}</span> },
              { key: 'f', header: 'File', render: (b) => b.file_name },
              { key: 'ds', header: 'Dataset', render: (b) => b.dataset },
              { key: 'src', header: 'Source', render: (b) => b.source_name || '-' },
              { key: 'st', header: 'Status', render: (b) => <Badge tone={statusTone(b.status)}>{b.status}</Badge> },
              { key: 'rc', header: 'Rows', align: 'right', render: (b) => formatNumber(b.row_count) },
              { key: 'vc', header: 'Staged', align: 'right', render: (b) => formatNumber(b.valid_count) },
              { key: 'ic', header: 'Invalid', align: 'right', render: (b) => formatNumber(b.invalid_count) },
              { key: 'sz', header: 'Size', align: 'right', render: (b) => formatBytes(b.size_bytes) },
              { key: 'at', header: 'Received', render: (b) => formatDateTime(b.received_at) },
            ]}
            rows={batches.data.items}
            emptyLabel="No files ingested yet."
            emptyHint="Upload a CSV above, or run: python scripts/seed_demo.py --upload http://127.0.0.1:8020/api/v1"
          />
        )}
      </Card>
    </>
  );
}
