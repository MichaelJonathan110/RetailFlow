'use client';

import { api } from '@/lib/api';
import { useApi } from '@/components/useApi';
import { Badge } from '@/components/Badge';
import { Card, Kpi } from '@/components/Card';
import { DataTable } from '@/components/Table';
import { ErrorState, Loading } from '@/components/States';
import { PageHeader } from '@/components/PageHeader';
import { Provenance } from '@/components/Provenance';
import { formatCurrency, formatDateTime, formatNumber, formatPercent, statusTone } from '@/lib/format';

interface ReconciliationRow {
  rec_id: number;
  run_id: string | null;
  batch_id: string | null;
  scope: string;
  expected_value: string | number;
  actual_value: string | number;
  variance: string | number;
  variance_pct: string | number;
  tolerance_pct: string | number;
  status: string;
  checked_at: string;
  note: string | null;
}

interface ReconciliationResponse {
  latest: ReconciliationRow[];
  current: {
    order_items_revenue: string | number;
    payments_revenue: string | number;
    order_item_orders: number;
    payment_orders: number;
  };
}

export default function ReconciliationPage() {
  const { data, loading, error, reload } = useApi<ReconciliationResponse>(() => api.get<ReconciliationResponse>('/reconciliation'));

  return (
    <>
      <PageHeader
        title="Data Reconciliation"
        subtitle="Independent totals compared across fact tables, with an explicit tolerance so a pass/fail verdict is auditable."
        action={<button className="rf-btn" onClick={reload}>Re-check</button>}
      />

      {loading && <Loading />}
      {error && <ErrorState message={error} onRetry={reload} />}

      {data && (
        <>
          <div className="rf-grid rf-grid-4" style={{ marginBottom: 14 }}>
            <Kpi label="Order-item revenue" value={formatCurrency(data.current.order_items_revenue)} meta="SUM(price)" />
            <Kpi label="Payment revenue" value={formatCurrency(data.current.payments_revenue)} meta="SUM(payment_value)" />
            <Kpi
              label="Variance"
              value={formatCurrency(Number(data.current.payments_revenue) - Number(data.current.order_items_revenue))}
              meta="Payments − items"
            />
            <Kpi label="Orders (items / payments)" value={`${formatNumber(data.current.order_item_orders)} / ${formatNumber(data.current.payment_orders)}`} />
          </div>

          <Card title="Reconciliation history" subtitle="Each check records the expected value, the actual value, the variance and the tolerance applied">
            <DataTable
              columns={[
                { key: 'scope', header: 'Scope', render: (r) => <span className="rf-mono">{r.scope}</span> },
                { key: 'exp', header: 'Expected', align: 'right', render: (r) => formatNumber(r.expected_value, 2) },
                { key: 'act', header: 'Actual', align: 'right', render: (r) => formatNumber(r.actual_value, 2) },
                { key: 'var', header: 'Variance', align: 'right', render: (r) => formatNumber(r.variance, 2) },
                { key: 'vp', header: 'Variance %', align: 'right', render: (r) => formatPercent(r.variance_pct, 3) },
                { key: 'tol', header: 'Tolerance', align: 'right', render: (r) => formatPercent(r.tolerance_pct, 2) },
                { key: 'st', header: 'Status', render: (r) => <Badge tone={statusTone(r.status)}>{r.status}</Badge> },
                { key: 'at', header: 'Checked', render: (r) => formatDateTime(r.checked_at) },
              ]}
              rows={data.latest}
              emptyLabel="No reconciliation has been run yet."
              emptyHint="Run the 'Revenue Reconciliation' pipeline from the Pipelines page."
            />
            <Provenance
              source="ops.data_reconciliation_results"
              note="fact_order_items and fact_payments have different grains (order item vs payment transaction), so totals are compared as aggregates — never by joining the two facts, which would multiply payment amounts by line-item count."
            />
          </Card>
        </>
      )}
    </>
  );
}
