# RetailFlow — Data Lineage

## 1. End-to-end path

```
source CSV (order_items / customers / products / sellers / payments)
   │  POST /api/v1/ingestion/upload          (or python scripts/seed_demo.py --upload ...)
   ▼
staging.stg_<dataset>          every column TEXT, raw_payload JSONB, validation_status
   │  rules from ops.data_quality_rules evaluated per row
   ├──────────────► ops.etl_rejects      (invalid rows: reason_code, severity, reason_detail, raw payload)
   │
   ▼  (validation_status = 'valid' only)
warehouse.dim_product / dim_seller / dim_geography
warehouse.dim_customer          SCD2: close changed version, open version + 1
   │
   ▼
warehouse.fact_order_items      grain: order item
warehouse.fact_payments         grain: payment transaction
   │
   ├──────────────► ops.data_quality_results   (per-rule outcome)
   ├──────────────► ops.data_reconciliation_results (expected vs actual + tolerance)
   │
   ▼
analytics.v_order_items → v_orders → v_revenue_by_month / _category / _region
                                  → v_top_products / v_order_status_distribution / v_payment_methods
                                  → v_revenue_reconciliation
   │
   ▼
RetailFlow API /api/v1  →  Next.js UI
                        →  Power BI semantic model
```

## 2. Column-level lineage (critical fields)

| Warehouse column | Derived from | Transformation |
| --- | --- | --- |
| `fact_order_items.date_key` | `stg_order_items.order_purchase_ts` | `to_char(ts::timestamptz,'YYYYMMDD')::int` |
| `fact_order_items.price` | `stg_order_items.price` | `::numeric(12,2)`, must satisfy `is_numeric` + `non_negative` |
| `fact_order_items.freight_value` | `stg_order_items.freight_value` | blank → `0` |
| `fact_order_items.total_item_value` | price + freight | computed in the load statement |
| `fact_order_items.customer_sk` | `dim_customer` via `customer_id` where `is_current` | lookup |
| `fact_order_items.geography_sk` | `dim_geography` via (city, state) | left join; null when unmatched |
| `dim_geography.region` | `stg_order_items.customer_state` | state → region map (see data dictionary) |
| `dim_customer.version` | previous max version + 1 | only when a tracked attribute changed |
| `fact_payments.date_key` | `fact_order_items` | min date_key for that order |
| `v_orders.*` | `v_order_items` | GROUP BY order_id — one row per order |

## 3. Provenance chain

Every fact row carries `batch_id` → `ops.ingest_batch` (file name, checksum, size, timestamps).
Every run carries `run_id` → `ops.etl_run_log` → `ops.etl_stage_log`.
Quality results carry both `run_id` and `batch_id`. Therefore, for any number in the UI you can answer:
**which file produced it, when it was loaded, which run loaded it, and which rules it passed.**

## 4. What lineage does NOT claim

- No claim is made about upstream systems beyond the uploaded file. The registry in `app.data_source`
  documents where a file is *expected* to come from; it is not a verified integration.
- Pentaho jobs are modelled as an alternative execution engine for the same logical path. They are not
evidenced as executed here (see `pentaho/README.md`).
