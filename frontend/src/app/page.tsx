'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api, type OverviewResponse } from '@/lib/api';
import { useApi } from '@/components/useApi';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';
import { Loading, ErrorState } from '@/components/States';
import { formatCompact, formatCurrency, formatDateTime, formatNumber } from '@/lib/format';

const SUBTITLE =
  'Warehouse health, pipeline activity and data-quality status at a glance.';

/* The one decision this screen supports: how far back to look. */
const RANGES = [
  { key: '12m', label: '12 months', months: 12 },
  { key: '6m', label: '6 months', months: 6 },
  { key: '3m', label: '3 months', months: 3 },
] as const;
type RangeKey = (typeof RANGES)[number]['key'];

const ACCENT = '#A15584';
const GRID = '#E3DDCE';
const TICK = '#6B645A';

function Spark({ values }: { values: number[] }) {
  if (!values || values.length < 2) return null;
  const w = 120;
  const h = 30;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / span) * (h - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = pts.join(' ');
  return (
    <svg className="rf-spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden>
      <polygon points={`0,${h} ${line} ${w},${h}`} fill="rgba(161,85,132,0.16)" />
      <polyline points={line} fill="none" stroke={ACCENT} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function ChartTip({ active, payload, label }: any) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rf-tip">
      <div className="rf-tip-label">{label}</div>
      {payload.map((p: any) => (
        <div className="rf-tip-row" key={p.dataKey}>
          <span className="rf-legend-dot" style={{ background: p.color }} />
          <span>{p.name}</span>
          <strong className="rf-num">
            {p.dataKey === 'revenue' ? formatCurrency(p.value) : formatNumber(p.value)}
          </strong>
        </div>
      ))}
    </div>
  );
}

function KpiCard({ label, value, meta, primary }: { label: string; value: string; meta?: string; primary?: boolean }) {
  return (
    <div className="rf-card rf-kpi" data-primary={primary || undefined}>
      <span className="rf-kpi-label">{label}</span>
      <span className="rf-kpi-value">{value}</span>
      {meta && <span className="rf-kpi-meta">{meta}</span>}
    </div>
  );
}

export default function DashboardPage() {
  const { data, loading, error, reload } = useApi<OverviewResponse>(() =>
    api.get<OverviewResponse>('/overview'),
  );
  const [mounted, setMounted] = useState(false);
  const [range, setRange] = useState<RangeKey>('12m');
  useEffect(() => setMounted(true), []);

  const months = RANGES.find((r) => r.key === range)?.months ?? 12;

  const allTrend = useMemo(
    () =>
      (data?.revenue_trend || []).map((t) => ({
        month: t.year_month,
        revenue: Number(t.total_revenue) || 0,
        orders: Number(t.orders) || 0,
      })),
    [data],
  );
  // The range selector is real: it slices the series the chart and the
  // insights are computed from.
  const trend = useMemo(() => allTrend.slice(-months), [allTrend, months]);

  if (loading) {
    return (
      <>
        <PageHeader eyebrow="Overview" title="Dashboard" lede={SUBTITLE} />
        <Loading label="Loading warehouse metrics…" />
      </>
    );
  }

  if (error || !data) {
    return (
      <>
        <PageHeader eyebrow="Overview" title="Dashboard" lede={SUBTITLE} />
        <ErrorState message={error || 'The API returned no data.'} onRetry={reload} />
      </>
    );
  }

  const k = data.kpis || {};
  const runs = data.recent_runs || [];
  const quality = data.latest_quality || [];

  const revSeries = trend.map((t) => t.revenue);
  const ordSeries = trend.map((t) => t.orders);

  const peak = trend.reduce(
    (a, b) => (b.revenue > a.revenue ? b : a),
    trend[0] || { month: '—', revenue: 0, orders: 0 },
  );
  const last = trend[trend.length - 1];
  const prev = trend[trend.length - 2];
  const mom =
    last && prev && prev.revenue ? ((last.revenue - prev.revenue) / prev.revenue) * 100 : null;

  const totalRuns = Number(k.etl_runs) || 0;
  const failed = Number(k.failed_runs) || 0;
  const successRate = totalRuns ? (totalRuns - failed) / totalRuns : null;
  const rowsLoaded = runs.reduce((s, r) => s + (Number(r.rows_loaded) || 0), 0);
  const latestRun = runs[0];
  const rangeLabel = RANGES.find((r) => r.key === range)?.label || '';

  const insights: { title: string; body: string }[] = [];
  if (peak && peak.month && trend.length) {
    insights.push({
      title: `Peak month in the last ${rangeLabel}`,
      body: `${peak.month} leads with ${formatCurrency(peak.revenue)} across ${formatNumber(peak.orders)} orders.`,
    });
  }
  if (mom !== null && last && prev) {
    insights.push({
      title: `Revenue ${mom >= 0 ? 'up' : 'down'} ${Math.abs(mom).toFixed(1)}% month on month`,
      body: `Latest month ${last.month} at ${formatCurrency(last.revenue)} versus ${prev.month} at ${formatCurrency(prev.revenue)}.`,
    });
  }
  if (totalRuns) {
    insights.push({
      title: 'Pipeline reliability',
      body: `${formatNumber(totalRuns)} ETL runs recorded, ${formatNumber(failed)} failed — a ${((successRate || 0) * 100).toFixed(1)}% success rate.`,
    });
  }
  if (Number(k.rejected_records)) {
    insights.push({
      title: 'Records quarantined',
      body: `${formatNumber(k.rejected_records)} rows were rejected with reasons and are available for review in Data Quality.`,
    });
  }

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Retail operations, in one clear view"
        lede={SUBTITLE}
        actions={
          <>
            <div className="rf-seg" role="group" aria-label="Date range">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  aria-pressed={range === r.key}
                  onClick={() => setRange(r.key)}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button className="rf-btn" onClick={reload}>
              Refresh
            </button>
          </>
        }
        source="warehouse.fact_order_items, ops.etl_run_log"
        updatedAt={latestRun?.finished_at || null}
        demo
        note={
          latestRun?.finished_at
            ? `Showing ${rangeLabel}. Last refresh ${formatDateTime(latestRun.finished_at)}.`
            : `Showing ${rangeLabel}.`
        }
      />

      <div className="rf-grid rf-grid-4 rf-stagger">
        <KpiCard primary label="Total revenue" value={formatCurrency(k.total_revenue ?? 0)} meta="Sum of order-item value" />
        <KpiCard label="Orders" value={formatCompact(k.orders ?? 0)} meta={`${formatCompact(k.order_items ?? 0)} order items`} />
        <KpiCard label="Products" value={formatCompact(k.products ?? 0)} meta={`${formatCompact(k.sellers ?? 0)} sellers`} />
        <KpiCard label="Customers" value={formatCompact(k.customers ?? 0)} meta="Current SCD2 versions" />
      </div>

      <div className="rf-grid rf-grid-4 rf-stagger" style={{ marginTop: 14 }}>
        <KpiCard label="ETL runs" value={formatCompact(k.etl_runs ?? 0)} meta={`${formatNumber(k.failed_runs ?? 0)} failed`} />
        <KpiCard label="Rejected records" value={formatCompact(k.rejected_records ?? 0)} meta="Quarantined with reasons" />
        <KpiCard label="Active DQ rules" value={formatCompact(k.active_rules ?? 0)} meta="Evaluated each run" />
        <KpiCard label="Quality checks" value={formatCompact(quality.length)} meta="Latest evaluation" />
      </div>

      <div className="rf-grid rf-grid-3" style={{ marginTop: 14 }}>
        <Card
          className="rf-span-2"
          title="Revenue and orders trend"
          subtitle={`Monthly totals from the warehouse fact table — last ${rangeLabel}.`}
          action={
            <div className="rf-inline">
              <span className="rf-legend-item"><span className="rf-legend-dot" style={{ background: ACCENT }} />Revenue</span>
              <span className="rf-legend-item"><span className="rf-legend-dot" style={{ background: '#7B6FC9' }} />Orders</span>
            </div>
          }
        >
          {trend.length ? (
            <div className="rf-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trend} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="2 4" stroke={GRID} vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: TICK }} tickLine={false} axisLine={{ stroke: GRID }} />
                  <YAxis tick={{ fontSize: 11, fill: TICK }} tickLine={false} axisLine={false} width={54} tickFormatter={(v) => formatCompact(Number(v))} />
                  <Tooltip content={<ChartTip />} />
                  <Area type="monotone" dataKey="revenue" name="Revenue" stroke={ACCENT} strokeWidth={2} fill="rgba(161,85,132,0.16)" />
                  <Area type="monotone" dataKey="orders" name="Orders" stroke="#7B6FC9" strokeWidth={1.6} fill="transparent" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="rf-note">No monthly revenue in the selected range yet.</p>
          )}
        </Card>

        <Card title="Data operations" subtitle="Latest run health">
          <dl className="rf-dl">
            <dt>Runs</dt>
            <dd className="rf-num">{formatCompact(k.etl_runs ?? 0)}</dd>
            <dt>Success rate</dt>
            <dd className="rf-num">{successRate === null ? '—' : `${(successRate * 100).toFixed(1)}%`}</dd>
            <dt>Rows loaded (recent)</dt>
            <dd className="rf-num">{formatCompact(rowsLoaded)}</dd>
            <dt>Rejected</dt>
            <dd className="rf-num">{formatCompact(k.rejected_records ?? 0)}</dd>
            <dt>Freshness</dt>
            <dd>{latestRun?.finished_at ? formatDateTime(latestRun.finished_at) : '—'}</dd>
          </dl>
          <div style={{ marginTop: 14 }}>
            <Link href="/monitoring" className="rf-btn">View ETL monitoring</Link>
          </div>
        </Card>
      </div>

      {insights.length > 0 && (
        <section className="rf-section">
          <h2 className="rf-section-title">What the data is telling us</h2>
          <div className="rf-grid rf-grid-2">
            {insights.map((it) => (
              <div className="rf-card" key={it.title}>
                <div className="rf-card-title">{it.title}</div>
                <p className="rf-note" style={{ marginTop: 4 }}>{it.body}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {mounted && (revSeries.length > 1 || ordSeries.length > 1) && (
        <section className="rf-section">
          <h2 className="rf-section-title">Series shape</h2>
          <div className="rf-grid rf-grid-2">
            <Card title="Revenue by month"><Spark values={revSeries} /></Card>
            <Card title="Orders by month"><Spark values={ordSeries} /></Card>
          </div>
        </section>
      )}
    </>
  );
}
