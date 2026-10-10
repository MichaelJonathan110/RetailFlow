'use client';

import { api } from '@/lib/api';
import { useApi } from '@/components/useApi';
import { Card, Kpi } from '@/components/Card';
import { DataTable } from '@/components/Table';
import { ErrorState, Loading } from '@/components/States';
import { PageHeader } from '@/components/PageHeader';
import { Provenance } from '@/components/Provenance';
import { formatNumber } from '@/lib/format';

interface FreshnessItem {
  dataset: string;
  table: string;
  owner: string;
  sla_minutes: number;
  last_updated: string | null;
  age_minutes: number | null;
  status: 'fresh' | 'late' | 'stale' | 'unknown';
  rows: number | null;
}

interface FreshnessResponse {
  items: FreshnessItem[];
  summary: { fresh: number; late: number; stale: number; unknown: number; checked_at: string };
}

function humanAge(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)} h`;
  return `${(minutes / 1440).toFixed(1)} d`;
}

function humanSla(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${minutes / 60} h`;
  return `${minutes / 1440} d`;
}

const TONE: Record<string, string> = { fresh: 'ok', late: 'warn', stale: 'danger', unknown: 'neutral' };

export default function FreshnessPage() {
  const { data, loading, error, reload } = useApi<FreshnessResponse>(() => api.get<FreshnessResponse>('/freshness'));

  return (
    <>
      <PageHeader
        title="Freshness & SLA"
        subtitle="How old each dataset is versus its service-level target, measured from real load timestamps."
        action={<button className="rf-btn" onClick={reload}>Refresh</button>}
        source="warehouse.fact_*, ops.ingest_batch, ops.data_quality_results, ops.etl_run_log"
        updatedAt={data?.summary?.checked_at || null}
        demo
      />

      {loading && !data ? (
        <Loading label="Measuring data freshness…" />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : data ? (
        <>
          <div className="rf-grid rf-grid-4 rf-stagger">
            <Kpi label="Fresh" value={formatNumber(data.summary.fresh)} meta="Within SLA" />
            <Kpi label="Late" value={formatNumber(data.summary.late)} meta="Up to 1.5× SLA" />
            <Kpi label="Stale" value={formatNumber(data.summary.stale)} meta="Beyond 1.5× SLA" />
            <Kpi label="Unknown" value={formatNumber(data.summary.unknown)} meta="No timestamp recorded" />
          </div>

          <div style={{ marginTop: 16 }}>
            <Card title="Dataset freshness" subtitle="Age is compared against each dataset's SLA window.">
              <DataTable
                columns={[
                  { key: 'd', header: 'Dataset', render: (r) => <span className="rf-mono">{r.dataset}</span> },
                  { key: 't', header: 'Table', render: (r) => <span className="rf-mono">{r.table}</span> },
                  { key: 'o', header: 'Owner', render: (r) => r.owner },
                  { key: 'sla', header: 'SLA', align: 'right', render: (r) => humanSla(r.sla_minutes) },
                  { key: 'age', header: 'Age', align: 'right', render: (r) => <span className="rf-num">{humanAge(r.age_minutes)}</span> },
                  { key: 'rows', header: 'Rows', align: 'right', render: (r) => (r.rows === null ? '—' : formatNumber(r.rows)) },
                  {
                    key: 'st',
                    header: 'Status',
                    render: (r) => (
                      <span className="rf-badge" data-tone={TONE[r.status] || 'neutral'}>{r.status}</span>
                    ),
                  },
                ]}
                rows={data.items}
                emptyLabel="No monitored datasets."
              />
              <Provenance
                source="GET /freshness"
                demo
                note="Freshness is derived from load/completion timestamps already written by the pipelines; a dataset with no rows reports 'unknown' rather than a fabricated age."
              />
            </Card>
          </div>
        </>
      ) : null}
    </>
  );
}
