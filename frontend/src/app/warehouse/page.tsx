'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
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

// WH_LAYOUT2: label/value lists as one column of rows so long DDL never overlaps.
const DL: CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8 };
const ROW: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(150px, 240px) minmax(0, 1fr)',
  gap: 14,
  alignItems: 'start',
};
const KEY: CSSProperties = { overflowWrap: 'anywhere', minWidth: 0 };
const VAL: CSSProperties = { overflowWrap: 'anywhere', minWidth: 0, whiteSpace: 'normal' };
const CONSTRAINT_TYPE: Record<string, string> = {
  p: 'PRIMARY KEY',
  u: 'UNIQUE',
  f: 'FOREIGN KEY',
  c: 'CHECK',
  x: 'EXCLUDE',
};
const SAMPLE_LIMIT = 10;

type TableInfo = { summary: string; grain: string; keys: string; loaded: string; why: string };

// Plain-language description of every table, shown above its technical definition.
const TABLE_INFO: Record<string, TableInfo> = {
  dim_date: {
    summary: 'Calendar dimension: one row per day from 2016-01-01 to 2020-12-31.',
    grain: 'One row per calendar day.',
    keys: 'date_key (YYYYMMDD integer, primary key); full_date.',
    loaded: 'Generated once by the warehouse seed script, not from an uploaded CSV.',
    why: 'Facts carry date_key, so revenue can be grouped by year, quarter, month, week or weekday without date functions.',
  },
  dim_customer: {
    summary: 'Customers with full location history (SCD Type 2).',
    grain: 'One row per customer version.',
    keys: 'customer_sk (surrogate key); customer_id (business key); unique (customer_id, version); a partial unique index allows only one is_current row per customer.',
    loaded: 'Dimension Load from staging.stg_customers. When city or state changes, the current row is closed (valid_to set, is_current = false) and a new row opens with version + 1.',
    why: 'Orders keep pointing to the customer version that was current when they were loaded, so history is never overwritten.',
  },
  dim_product: {
    summary: 'Product catalogue: id, category and name.',
    grain: 'One row per product.',
    keys: 'product_sk (surrogate key); product_id unique.',
    loaded: 'Upsert from staging.stg_products (SCD Type 1: latest category and name overwrite the old values).',
    why: 'Revenue by category and top products come from joining facts to this table.',
  },
  dim_seller: {
    summary: 'Marketplace sellers and their location.',
    grain: 'One row per seller.',
    keys: 'seller_sk (surrogate key); seller_id unique.',
    loaded: 'Insert-only from staging.stg_sellers; an existing seller_id is left unchanged.',
    why: 'Powers the top sellers ranking; order items with an unknown seller are rejected by the OI_SELLER_REF rule.',
  },
  dim_geography: {
    summary: 'City and state with their Brazilian region (North, Northeast, Central-West, Southeast, South).',
    grain: 'One row per (city, state).',
    keys: 'geography_sk (surrogate key); unique (city, state).',
    loaded: 'Derived from the customer city and state in staged order items, using a state-to-region map.',
    why: 'Revenue by region on the Analytics page is grouped through this table.',
  },
  fact_order_items: {
    summary: 'Main sales fact: every item of every order with its price and freight.',
    grain: 'One row per order item (order_id + order_item_id).',
    keys: 'Unique (order_id, order_item_id); foreign keys date_key, customer_sk, product_sk, seller_sk, geography_sk.',
    loaded: 'Fact Load from valid staging rows. Only business keys not yet present are inserted, so re-running the pipeline adds 0 rows.',
    why: 'Measures: price, freight_value, total_item_value. batch_id links every row back to the uploaded file (lineage).',
  },
  fact_payments: {
    summary: 'Payment fact: each payment or installment of an order.',
    grain: 'One row per payment (order_id + payment_sequential).',
    keys: 'Unique (order_id, payment_sequential); date_key taken from the order.',
    loaded: 'Fact Load from staging.stg_payments, insert-only on the business key.',
    why: 'Different grain from fact_order_items, so the two are never joined row by row; Reconciliation compares their totals instead.',
  },
  stg_order_items: {
    summary: 'Landing table for uploaded order item CSVs, exactly as received.',
    grain: 'One row per uploaded CSV row.',
    keys: 'stg_id; batch_id + row_number point to the exact file line.',
    loaded: 'Written by POST /ingestion/upload. Valid and invalid rows are both kept, with raw_payload and validation_status.',
    why: 'Nothing is discarded: rejected rows stay here and in ops.etl_rejects with the reason. Only valid rows move on to the facts.',
  },
  stg_customers: {
    summary: 'Landing table for uploaded customer CSVs.',
    grain: 'One row per uploaded CSV row (append-only).',
    keys: 'stg_id; batch_id + row_number.',
    loaded: 'Written by the upload. The dimension load takes the latest row per customer_id.',
    why: 'Source of the SCD Type 2 changes in dim_customer.',
  },
  stg_products: {
    summary: 'Landing table for uploaded product CSVs.',
    grain: 'One row per uploaded CSV row (append-only).',
    keys: 'stg_id; batch_id + row_number.',
    loaded: 'Written by the upload. The dimension load takes the latest row per product_id.',
    why: 'Source of dim_product.',
  },
  stg_sellers: {
    summary: 'Landing table for uploaded seller CSVs.',
    grain: 'One row per uploaded CSV row (append-only).',
    keys: 'stg_id; batch_id + row_number.',
    loaded: 'Written by the upload.',
    why: 'Source of dim_seller.',
  },
  stg_payments: {
    summary: 'Landing table for uploaded payment CSVs.',
    grain: 'One row per uploaded CSV row (append-only).',
    keys: 'stg_id; batch_id + row_number.',
    loaded: 'Written by the upload.',
    why: 'Source of fact_payments.',
  },
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
  const dTable = (d as unknown as { table?: string } | null)?.table;
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  useEffect(() => {
    if (detail.data) setLoadedAt(new Date().toISOString());
  }, [detail.data]);
  const switching = detail.loading || (!!d && !!dTable && dTable !== active);
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
        const text = typeof v === 'object' ? JSON.stringify(v) : String(v);
        return <span style={{ whiteSpace: 'nowrap' }}>{text}</span>;
      },
    }));
  }, [d]);


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
        <Card title={`${activeSchema || '—'} tables`} subtitle="Click a table to see what it stores, its grain and keys, its columns and a sample of rows.">
          <div className="rf-grid rf-grid-2" role="listbox" aria-label="Tables">
            {visible.map((t) => {
              const on = t.table === active;
              return (
                <button
                  key={t.table}
                  type="button"
                  role="option"
                  aria-selected={on}
                  data-table={t.table}
                  data-active={on}
                  className="rf-card"
                  onClick={() => setSelected(t.table)}
                  style={{
                    textAlign: 'left',
                    cursor: 'pointer',
                    font: 'inherit',
                    color: 'inherit',
                    outline: on ? '3px solid currentColor' : undefined,
                    outlineOffset: on ? 2 : undefined,
                  }}
                >
                  <div className="rf-inline" style={{ justifyContent: 'space-between', gap: 8 }}>
                    <code className="rf-mono">{t.table}</code>
                    <Badge tone={kindTone(t.kind)}>{t.kind}</Badge>
                  </div>
                  <p style={{ margin: '6px 0', fontSize: 13, lineHeight: 1.45 }}>{TABLE_INFO[t.table]?.summary ?? ''}</p>
                  <span className="rf-mono" style={{ fontSize: 11 }}>
                    {t.rows === null ? '—' : formatNumber(t.rows)} rows · {formatNumber(t.columns)} columns
                    {on ? ' · selected' : ''}
                  </span>
                </button>
              );
            })}
          </div>
          {visible.length === 0 && <p className="rf-note">No tables in this schema.</p>}
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
            {switching ? (
              <Loading label="Loading table" />
            ) : detail.error ? (
              <ErrorState message={detail.error} onRetry={detail.reload} />
            ) : d ? (
              <>
                {TABLE_INFO[active] && (
                  <>
                    <h4 className="rf-subhead">About this table</h4>
                    <div className="rf-dl" style={DL} data-testid="table-about">
                      <div className="rf-dl-row" style={ROW}><span className="rf-dl-key rf-mono" style={KEY}>Purpose</span><span className="rf-dl-val" style={VAL}>{TABLE_INFO[active].summary}</span></div>
                      <div className="rf-dl-row" style={ROW}><span className="rf-dl-key rf-mono" style={KEY}>Grain</span><span className="rf-dl-val" style={VAL}>{TABLE_INFO[active].grain}</span></div>
                      <div className="rf-dl-row" style={ROW}><span className="rf-dl-key rf-mono" style={KEY}>Keys</span><span className="rf-dl-val" style={VAL}>{TABLE_INFO[active].keys}</span></div>
                      <div className="rf-dl-row" style={ROW}><span className="rf-dl-key rf-mono" style={KEY}>How it is loaded</span><span className="rf-dl-val" style={VAL}>{TABLE_INFO[active].loaded}</span></div>
                      <div className="rf-dl-row" style={ROW}><span className="rf-dl-key rf-mono" style={KEY}>Why it matters</span><span className="rf-dl-val" style={VAL}>{TABLE_INFO[active].why}</span></div>
                    </div>
                  </>
                )}
                <h4 className="rf-subhead">Columns</h4>
                <DataTable<Col> columns={colCols} rows={d.columns as Col[]} emptyLabel="No columns." />
                {d.constraints?.some((c) => c.type !== 'n') && (
                  <>
                    <h4 className="rf-subhead">Constraints</h4>
                    <p className="rf-note">NOT NULL rules are shown in the Nullable column above.</p>
                    <div className="rf-dl" style={DL}>
                      {d.constraints.filter((c) => c.type !== 'n').map((c) => (
                        <div key={c.name} className="rf-dl-row" style={ROW}>
                          <span className="rf-dl-key rf-mono" style={KEY}>{c.name}</span>
                          <span className="rf-dl-val" style={VAL}><Badge tone="neutral">{CONSTRAINT_TYPE[c.type] ?? c.type}</Badge> {c.definition}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {d.indexes?.length > 0 && (
                  <>
                    <h4 className="rf-subhead">Indexes</h4>
                    <div className="rf-dl" style={DL}>
                      {d.indexes.map((ix) => (
                        <div key={ix.indexname} className="rf-dl-row" style={ROW}>
                          <span className="rf-dl-key rf-mono" style={KEY}>{ix.indexname}</span>
                          <span className="rf-dl-val" style={VAL}>{ix.indexdef}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                {sampleCols.length > 0 && (
                  <>
                    <h4 className="rf-subhead">Sample rows (first {Math.min(SAMPLE_LIMIT, d.sample_rows.length)})</h4>
                    <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
                      <DataTable<Record<string, unknown>>
                        columns={sampleCols}
                        rows={d.sample_rows.slice(0, SAMPLE_LIMIT)}
                        emptyLabel="No sample rows available."
                      />
                    </div>
                  </>
                )}
              </>
            ) : null}
          </Card>
          <Provenance source="GET /warehouse/tables · /warehouse/tables/{table}" updatedAt={loadedAt} note="Live PostgreSQL catalogue." />
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
