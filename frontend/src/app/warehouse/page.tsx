'use client';

import { useMemo, useState } from 'react';
import { api, type ListResponse, type WarehouseTable, type WarehouseTableDetail } from '@/lib/api';
import { useApi } from '@/components/useApi';
import { Badge } from '@/components/Badge';
import { Card } from '@/components/Card';
import { DataTable, type Column } from '@/components/Table';
import { ErrorState, Loading } from '@/components/States';
import { Provenance } from '@/components/Provenance';
import { formatNumber } from '@/lib/format';

const SUBTITLE =
  'The dimensional model behind the analytics: fact and dimension tables, their columns, keys and row counts.';

type Col = { column_name: string; data_type: string; is_nullable: string; column_default: string | null };

const kindTone = (kind: string) => {
  const k = (kind || '').toLowerCase();
  if (k.includes('fact')) return 'info' as const;
  if (k.includes('dim')) return 'success' as const;
  if (k.includes('view')) return 'neutral' as const;
  return 'neutral' as const;
};

export default function WarehousePage() {
  const tables = useApi<ListResponse<WarehouseTable>>(() =>
    api.get<ListResponse<WarehouseTable>>('/warehouse/tables'),
  );
  const [schema, setSchema] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const rows = tables.data?.items ?? [];
  const schemas = useMemo(() => Array.from(new Set(rows.map((t) => t.schema))), [rows]);
  const activeSchema = schema ?? schemas[0] ?? null;
  const visible = rows.filter((t) => t.schema === activeSchema);
  const active = selected ?? visible[0]?.table ?? null;

  const detail = useApi<WarehouseTableDetail | null>(
    () =>
      active && activeSchema
        ? api.get<WarehouseTableDetail>(`/warehouse/tables/${activeSchema}/${active}`)
        : Promise.resolve(null),
    [active, activeSchema],
  );

  const d = detail.data;
  const colCols: Column<Col>[] = [
    { key: 'name', header: 'Column', render: (c) => <code className="rf-mono">{c.column_name}</code> },
    { key: 'type', header: 'Type', render: (c) => c.data_type },
    { key: 'null', header: 'Nullable', render: (c) => (c.is_nullable === 'YES' ? 'yes' : 'no') },
    { key: 'default', header: 'Default', render: (c) => c.column_default || '—' },
  ];

  const sampleCols: Column<Record<string, unknown>>[] = useMemo(() => {
    if (!d?.sample_rows?.length) return [];
    return Object.keys(d.sample_rows[0]).map((k) => ({
      key: k,
      header: k,
      render: (row: Record<string, unknown>) => {
        const v = row[k];
        if (v === null || v === undefined) return '—';
        if (typeof v === 'object') return JSON.stringify(v);
        return String(v);
      },
    }));
  }, [d]);

  const tableCols: Column<WarehouseTable>[] = [
    { key: 'table', header: 'Table', render: (t) => <code className="rf-mono">{t.table}</code> },
    { key: 'kind', header: 'Kind', render: (t) => <Badge tone={kindTone(t.kind)}>{t.kind}</Badge> },
    { key: 'rows', header: 'Rows', align: 'right', render: (t) => (t.rows === null ? '—' : formatNumber(t.rows)) },
    { key: 'cols', header: 'Columns', align: 'right', render: (t) => formatNumber(t.columns) },
  ];

  if (tables.loading && !tables.data) {
    return (
      <>
        <PageHero />
        <Loading label="Loading warehouse" />
      </>
    );
  }
  if (tables.error) {
    return (
      <>
        <PageHero />
        <ErrorState message={tables.error} onRetry={tables.reload} />
      </>
    );
  }

  const totalRows = rows.reduce((s, t) => s + (t.rows || 0), 0);
  const facts = rows.filter((t) => (t.kind || '').toLowerCase().includes('fact')).length;
  const dims = rows.filter((t) => (t.kind || '').toLowerCase().includes('dim')).length;

  return (
    <>
      <PageHero />

      <div className="rf-kpi-grid rf-stagger">
        <div className="rf-kpi-card" data-tone="blue">
          <span className="rf-kpi-label">Tables</span>
          <span className="rf-kpi-value">{formatNumber(rows.length)}</span>
          <span className="rf-kpi-meta">{schemas.length} schemas</span>
        </div>
        <div className="rf-kpi-card" data-tone="green">
          <span className="rf-kpi-label">Fact tables</span>
          <span className="rf-kpi-value">{formatNumber(facts)}</span>
          <span className="rf-kpi-meta">Measures at a defined grain</span>
        </div>
        <div className="rf-kpi-card" data-tone="lavender">
          <span className="rf-kpi-label">Dimension tables</span>
          <span className="rf-kpi-value">{formatNumber(dims)}</span>
          <span className="rf-kpi-meta">Descriptive context</span>
        </div>
        <div className="rf-kpi-card" data-tone="butter">
          <span className="rf-kpi-label">Rows tracked</span>
          <span className="rf-kpi-value">{formatNumber(totalRows)}</span>
          <span className="rf-kpi-meta">Approximate counts</span>
        </div>
      </div>

      <section className="rf-section">
        <div className="rf-panel-head">
          <h2 className="rf-section-title" style={{ margin: 0 }}>Schemas</h2>
          <div className="rf-seg" role="group" aria-label="Schema">
            {schemas.map((sc) => (
              <button
                key={sc}
                data-active={sc === activeSchema}
                onClick={() => {
                  setSchema(sc);
                  setSelected(null);
                }}
              >
                {sc}
              </button>
            ))}
          </div>
        </div>
        <Card title={`${activeSchema || '—'} tables`} subtitle="Select a table to inspect its definition and a sample of rows.">
          <DataTable<WarehouseTable>
            columns={tableCols}
            rows={visible}
            emptyLabel="No tables in this schema."
          />
        </Card>
      </section>

      {active && (
        <section className="rf-section">
          <h2 className="rf-section-title">Table detail — {active}</h2>
          <Card
            title={active}
            subtitle={d?.comment || `${d?.columns?.length ?? 0} columns`}
            action={
              <button className="rf-btn" data-variant="ghost" onClick={detail.reload}>
                Refresh
              </button>
            }
          >
            {detail.loading && !detail.data ? (
              <Loading label="Loading table" />
            ) : detail.error ? (
              <ErrorState message={detail.error} onRetry={detail.reload} />
            ) : d ? (
              <>
                <h4 className="rf-subhead">Columns</h4>
                <DataTable<Col> columns={colCols} rows={d.columns as Col[]} emptyLabel="No columns." />
                {d.constraints?.length > 0 && (
                  <>
                    <h4 className="rf-subhead">Constraints</h4>
                    <div className="rf-dl">
                      {d.constraints.map((c) => (
                        <div key={c.name} className="rf-dl-row">
                          <span className="rf-dl-key">{c.name}</span>
                          <span className="rf-dl-val"><Badge tone="neutral">{c.type}</Badge> {c.definition}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {d.indexes?.length > 0 && (
                  <>
                    <h4 className="rf-subhead">Indexes</h4>
                    <div className="rf-dl">
                      {d.indexes.map((ix) => (
                        <div key={ix.indexname} className="rf-dl-row">
                          <span className="rf-dl-key">{ix.indexname}</span>
                          <span className="rf-dl-val">{ix.indexdef}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {sampleCols.length > 0 && (
                  <>
                    <h4 className="rf-subhead">Sample rows</h4>
                    <DataTable<Record<string, unknown>>
                      columns={sampleCols}
                      rows={d.sample_rows}
                      emptyLabel="No sample rows available."
                    />
                  </>
                )}
              </>
            ) : null}
          </Card>
          <Provenance source="GET /warehouse/tables · /warehouse/tables/{table}" updatedAt={null} note="Live PostgreSQL catalogue." />
        </section>
      )}
    </>
  );
}

function PageHero() {
  return (
    <header className="rf-hero rf-rise">
      <p className="rf-eyebrow">Model</p>
      <h1 className="rf-display">Warehouse explorer</h1>
      <p className="rf-lede">{SUBTITLE}</p>
    </header>
  );
}
