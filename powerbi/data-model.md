# RetailFlow — Power BI Semantic Model

## 1. Tables to import

### Fact-like views (import these, not the base facts)

| Object | Grain | Rows (demo) | Purpose |
| --- | --- | --- | --- |
| `analytics.v_order_items` | order item | ~2 400 | every revenue measure except AOV |
| `analytics.v_orders` | **order** | ~1 500 | order counts, AOV, items per order |
| `analytics.v_revenue_reconciliation` | 1 row | 1 | reconciliation card |
| `warehouse.fact_payments` | payment transaction | ~2 100 | payment-method analysis |

### Dimensions

| Object | Key | Notes |
| --- | --- | --- |
| `warehouse.dim_date` | `date_key` | mark as the official **Date table** (`full_date`) |
| `warehouse.dim_product` | `product_sk` | category, name |
| `warehouse.dim_seller` | `seller_sk` | city, state |
| `warehouse.dim_customer` | `customer_sk` | **filter to `is_current = true`** for current-state analysis |
| `warehouse.dim_geography` | `geography_sk` | city, state, region |

### Operational tables

| Object | Purpose |
| --- | --- |
| `ops.etl_run_log` | run history, durations, failures |
| `ops.data_quality_results` | rule outcomes over time |
| `ops.etl_rejects` | quarantined rows and reasons |
| `ops.data_reconciliation_results` | expected vs actual with tolerance |
| `app.etl_pipeline` | pipeline names (join to `etl_run_log`) |

## 2. Relationships

```
dim_date[date_key]            1 ── * v_order_items[date_key]
dim_date[date_key]            1 ── * fact_payments[date_key]      (inactive; activate for payment-by-date)
dim_product[product_sk]       1 ── * v_order_items[product_sk]
dim_seller[seller_sk]         1 ── * v_order_items[seller_sk]
dim_customer[customer_sk]     1 ── * v_order_items[customer_sk]
dim_geography[geography_sk]   1 ── * v_order_items[geography_sk]
app.etl_pipeline[pipeline_id] 1 ── * ops.etl_run_log[pipeline_id]
```

All relationships are **one-to-many, single direction**, with referential integrity assumed.

### Forbidden relationships

- `v_order_items` ⇄ `fact_payments` — **never**. Different grains; a relationship multiplies payment
  amounts by line-item count. Analyse payments through `fact_payments` with its own dimension joins, and
  compare totals with the reconciliation measures.
- `v_orders` ⇄ `v_order_items` — do **not** relate these either; they are two different grains of the same
  data. Keep them as independent tables with a shared `dim_date`.

## 3. Date table

`dim_date` covers **2016-01-01 → 2020-12-31** and is marked as the date table on `full_date`.
Every time-intelligence measure requires this mark.

## 4. Row-level security (optional, documented not configured)

For a regional analyst, create a role filtering `dim_geography[region]`:
`[region] = "Southeast"`. Documented here so a real deployment can add it; the demo ships with no RLS.

## 5. Refresh

Import mode. Schedule a refresh after the ETL pipelines run. For a real deployment, trigger the refresh from
Power BI's REST API at the end of the master pipeline.
