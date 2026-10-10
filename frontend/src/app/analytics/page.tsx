'use client';

import { useEffect, useState } from 'react';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api, type ListResponse } from '@/lib/api';
import { useApi } from '@/components/useApi';
import { Card, Kpi } from '@/components/Card';
import { DataTable } from '@/components/Table';
import { ErrorState, Loading } from '@/components/States';
import { PageHeader } from '@/components/PageHeader';
import { Provenance } from '@/components/Provenance';
import { formatCompact, formatCurrency, formatNumber } from '@/lib/format';

const PALETTE = ['#A15584', '#7B6FC9', '#FED01A', '#0E7A38', '#A85C00', '#1E4DE8', '#BEAF7E', '#C81E1E', '#4A443C', '#6B645A'];

interface Summary {
  total_revenue: string | number;
  orders: number;
  units: number;
  avg_order_value: string | number;
  avg_items_per_order: string | number;
}

interface MonthRow { year_month: string; total_revenue: string | number; item_revenue: string | number; orders: number; units: number }
interface CategoryRow { product_category: string; item_revenue: string | number; total_revenue: string | number; units: number; orders: number }
interface RegionRow { customer_region: string; customer_state: string; total_revenue: string | number; orders: number; units: number }
interface ProductRow { product_id: string; product_category: string; product_name: string; total_revenue: string | number; units: number; orders: number }
interface StatusRow { order_status: string; orders: number; total_revenue: string | number }
interface PaymentRow { payment_type: string; payments: number; payment_value: string | number }

const chartTooltip = {
  contentStyle: { background: '#FFFFFF', border: '2px solid #0E0D0F', borderRadius: 2, fontSize: 12, boxShadow: '4px 4px 0 #0E0D0F' },
};

export default function AnalyticsPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const summary = useApi<Summary>(() => api.get<Summary>('/analytics/summary'));
  const months = useApi<{ items: MonthRow[] }>(() => api.get('/analytics/revenue-by-month'));
  const categories = useApi<{ items: CategoryRow[] }>(() => api.get('/analytics/revenue-by-category?limit=10'));
  const regions = useApi<{ items: RegionRow[] }>(() => api.get('/analytics/revenue-by-region'));
  const products = useApi<{ items: ProductRow[] }>(() => api.get('/analytics/top-products?limit=10'));
  const statuses = useApi<{ items: StatusRow[] }>(() => api.get('/analytics/order-status'));
  const payments = useApi<{ items: PaymentRow[] }>(() => api.get('/analytics/payment-methods'));
  const sellers = useApi<{ items: { seller_id: string; seller_state: string; orders: number; units: number; total_revenue: string | number }[] }>(
    () => api.get('/analytics/top-sellers?limit=10'),
  );

  const anyError = summary.error || months.error || categories.error || regions.error;
  const reloadAll = () => {
    summary.reload(); months.reload(); categories.reload(); regions.reload();
    products.reload(); statuses.reload(); payments.reload(); sellers.reload();
  };

  const monthData = (months.data?.items ?? []).map((m) => ({ month: m.year_month, revenue: Number(m.total_revenue), orders: m.orders }));
  const catData = (categories.data?.items ?? []).map((c) => ({ name: c.product_category.replace(/_/g, ' '), revenue: Number(c.total_revenue) }));
  const payData = (payments.data?.items ?? []).map((p) => ({ name: p.payment_type.replace(/_/g, ' '), value: Number(p.payment_value) }));

  return (
    <>
      <PageHeader
        title="Retail Analytics"
        subtitle="Business measures computed from the dimensional warehouse — revenue, orders, categories, regions, payments."
        action={<button className="rf-btn" onClick={reloadAll}>Refresh</button>}
      />

      {anyError && <div style={{ marginBottom: 14 }}><ErrorState message={anyError} onRetry={reloadAll} /></div>}
      {summary.loading && <Loading label="Loading analytics..." />}

      {summary.data && (
        <div className="rf-grid rf-grid-4" style={{ marginBottom: 14 }}>
          <Kpi label="Total revenue" value={formatCurrency(summary.data.total_revenue)} meta="Includes freight" />
          <Kpi label="Orders" value={formatCompact(summary.data.orders)} meta={`${formatCompact(summary.data.units)} units`} />
          <Kpi label="Average order value" value={formatCurrency(summary.data.avg_order_value)} meta="Per order, from analytics.v_orders" />
          <Kpi label="Avg items per order" value={formatNumber(summary.data.avg_items_per_order, 2)} />
        </div>
      )}

      <div className="rf-grid rf-grid-2" style={{ marginBottom: 14 }}>
        <Card title="Revenue by month" subtitle="Sum of order-item value including freight">
          {mounted && monthData.length > 0 ? (
            <ResponsiveContainer width="100%" height={340}>
              <LineChart data={monthData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#E3DDCE" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="month" stroke="#6B645A" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#6B645A" fontSize={12} tickLine={false} axisLine={false} tickFormatter={formatCompact} />
                <Tooltip {...chartTooltip} formatter={(v: number) => [formatCurrency(v), 'Revenue']} />
                <Line type="monotone" dataKey="revenue" stroke="#A15584" strokeWidth={2} dot={{ r: 3, fill: '#A15584', stroke: '#0E0D0F', strokeWidth: 1 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : <Loading label="No revenue data loaded yet." />}
          <Provenance source="analytics.v_revenue_by_month" demo />
        </Card>

        <Card title="Revenue by category" subtitle="Top 10 product categories">
          {mounted && catData.length > 0 ? (
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={catData} margin={{ top: 6, right: 8, left: 0, bottom: 54 }}>
                <CartesianGrid stroke="#E3DDCE" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" stroke="#6B645A" fontSize={11} tickLine={false} axisLine={false} angle={-32} textAnchor="end" interval={0} />
                <YAxis stroke="#6B645A" fontSize={12} tickLine={false} axisLine={false} tickFormatter={formatCompact} />
                <Tooltip {...chartTooltip} formatter={(v: number) => [formatCurrency(v), 'Revenue']} />
                <Bar dataKey="revenue" radius={[4, 4, 0, 0]}>
                  {catData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <Loading label="No category data yet." />}
          <Provenance source="analytics.v_revenue_by_category" demo />
        </Card>
      </div>

      <div className="rf-grid rf-grid-2" style={{ marginBottom: 14 }}>
        <Card title="Payment methods" subtitle="Share of payment value">
          {mounted && payData.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <PieChart>
                <Pie data={payData} dataKey="value" nameKey="name" innerRadius={72} outerRadius={122} paddingAngle={2}>
                  {payData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                </Pie>
                <Legend wrapperStyle={{ fontSize: 12.5 }} />
                <Tooltip {...chartTooltip} formatter={(v: number) => formatCurrency(v)} />
              </PieChart>
            </ResponsiveContainer>
          ) : <Loading label="No payment data yet." />}
          <Provenance source="analytics.v_payment_methods" demo note="Payment value is summed from warehouse.fact_payments, which has a different grain from the order-item fact." />
        </Card>

        <Card title="Order status distribution" subtitle="Orders by fulfilment status">
          {statuses.data && (
            <DataTable
              columns={[
                { key: 's', header: 'Status', render: (r) => <span className="rf-mono">{r.order_status}</span> },
                { key: 'o', header: 'Orders', align: 'right', render: (r) => formatNumber(r.orders) },
                { key: 'r', header: 'Revenue', align: 'right', render: (r) => formatCurrency(r.total_revenue) },
              ]}
              rows={statuses.data.items}
              emptyLabel="No orders loaded."
            />
          )}
          <Provenance source="analytics.v_order_status_distribution" demo />
        </Card>
      </div>

      <div className="rf-grid rf-grid-2" style={{ marginBottom: 14 }}>
        <Card title="Top products" subtitle="By total revenue">
          {products.data && (
            <DataTable
              columns={[
                { key: 'n', header: 'Product', render: (r) => r.product_name || r.product_id.slice(0, 10) },
                { key: 'c', header: 'Category', render: (r) => <span className="rf-mono">{r.product_category}</span> },
                { key: 'u', header: 'Units', align: 'right', render: (r) => formatNumber(r.units) },
                { key: 'r', header: 'Revenue', align: 'right', render: (r) => formatCurrency(r.total_revenue) },
              ]}
              rows={products.data.items}
              emptyLabel="No product sales yet."
            />
          )}
          <Provenance source="analytics.v_top_products" demo />
        </Card>

        <Card title="Top sellers" subtitle="By total revenue">
          {sellers.data && (
            <DataTable
              columns={[
                { key: 's', header: 'Seller', render: (r) => <span className="rf-mono">{r.seller_id.slice(0, 14)}</span> },
                { key: 'st', header: 'State', render: (r) => r.seller_state },
                { key: 'o', header: 'Orders', align: 'right', render: (r) => formatNumber(r.orders) },
                { key: 'r', header: 'Revenue', align: 'right', render: (r) => formatCurrency(r.total_revenue) },
              ]}
              rows={sellers.data.items}
              emptyLabel="No seller activity yet."
            />
          )}
          <Provenance source="analytics.v_order_items ⋈ warehouse.dim_seller" demo />
        </Card>
      </div>

      <Card title="Revenue by region" subtitle="Customer region and state, derived from the Brazilian UF grouping">
        {regions.data && (
          <DataTable
            columns={[
              { key: 'r', header: 'Region', render: (r) => r.customer_region },
              { key: 's', header: 'State', render: (r) => <span className="rf-mono">{r.customer_state}</span> },
              { key: 'o', header: 'Orders', align: 'right', render: (r) => formatNumber(r.orders) },
              { key: 'u', header: 'Units', align: 'right', render: (r) => formatNumber(r.units) },
              { key: 'rev', header: 'Revenue', align: 'right', render: (r) => formatCurrency(r.total_revenue) },
            ]}
            rows={regions.data.items}
            emptyLabel="No regional data yet."
          />
        )}
        <Provenance source="analytics.v_revenue_by_region" demo note="Region is mapped from the state code in warehouse.dim_geography; the mapping is documented in docs/data-dictionary.md." />
      </Card>
    </>
  );
}
