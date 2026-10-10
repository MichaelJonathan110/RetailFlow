# RetailFlow — Architecture

## 1. Layered data architecture

```
                 ┌─────────────────────────────────────────────────────────────┐
 Source files    │  CSV uploads (order_items, customers, products, sellers,     │
 / APIs          │  payments) + optional Pentaho extraction                     │
                 └────────────────────────────┬────────────────────────────────┘
                                              │
                        ┌─────────────────────▼─────────────────────┐
   STAGING              │  staging.stg_*                            │
   (as received)        │  every column TEXT + raw_payload JSONB    │
                        │  + validation_status, batch_id, row_number│
                        └─────────────────────┬─────────────────────┘
                                              │
                        ┌─────────────────────▼─────────────────────┐
   QUALITY              │  ops.data_quality_rules  (rules as data)   │
                        │  → ops.data_quality_results                │
                        │  → ops.etl_rejects (quarantine + reason)    │
                        └─────────────────────┬─────────────────────┘
                                              │  validated rows only
                        ┌─────────────────────▼─────────────────────┐
   WAREHOUSE            │  warehouse.dim_*  (conformed, SCD2 on      │
   (star schema)        │                   dim_customer)            │
                        │  warehouse.fact_order_items (order item)   │
                        │  warehouse.fact_payments    (payment)      │
                        └─────────────────────┬─────────────────────┘
                                              │
                        ┌─────────────────────▼─────────────────────┐
   ANALYTICS            │  analytics.v_* read-only views             │
                        │  v_order_items, v_orders, v_revenue_by_*,  │
                        │  v_top_products, v_payment_methods,        │
                        │  v_revenue_reconciliation                  │
                        └─────────────────────┬─────────────────────┘
                                              │
                 ┌────────────────────────────▼────────────────────────────────┐
 Consumers       │  RetailFlow API (/api/v1)  →  Next.js UI                      │
                 │                            →  Power BI semantic model        │
                 └─────────────────────────────────────────────────────────────┘
```

## 2. Schemas and their responsibilities

| Schema | Purpose | Mutable by |
| --- | --- | --- |
| `app` | Configuration: sources, pipeline definitions, stages, settings | Seed + settings API |
| `ops` | Operations: batches, runs, stage runs, quality rules/results, rejects, reconciliation | Ingestion + pipeline runner |
| `staging` | Raw landing zone, source-aligned | Ingestion only |
| `warehouse` | Conformed dimensions and facts | Transform only |
| `analytics` | Read-only views for BI/API consumption | Nobody (views) |

## 3. The two facts and why they are never joined

| Fact | Grain | Measures |
| --- | --- | --- |
| `fact_order_items` | one row per **order item** | `price`, `freight_value`, `total_item_value`, `quantity` |
| `fact_payments` | one row per **payment transaction** | `payment_value` |

An order with 3 items and 2 payments has 3 order-item rows and 2 payment rows.
Joining them directly produces a 6-row cross product, inflating every revenue measure.
RetailFlow therefore:

1. Never joins the two facts in an aggregating query.
2. Exposes `analytics.v_orders` (one row per order) as the **only** correct denominator for Average Order Value.
3. Compares the two facts **as aggregates** in `analytics.v_revenue_reconciliation` and records the variance with an explicit tolerance in `ops.data_reconciliation_results`.

## 4. Data-quality engine

Rules live in `ops.data_quality_rules.expression` as `<check>:<column>[:<arg>...]`:

| Check | Example | Meaning |
| --- | --- | --- |
| `not_null` | `not_null:order_id` | value must be present |
| `is_integer` | `is_integer:order_item_id` | parseable as an integer |
| `is_numeric` | `is_numeric:price` | parseable as a number |
| `non_negative` | `non_negative:price` | numeric and ≥ 0 |
| `valid_timestamp` | `valid_timestamp:order_purchase_ts` | parseable as a date/time |
| `date_in_range` | `date_in_range:order_purchase_ts:2016-01-01:2020-12-31` | inside a window |
| `allowed_values` | `allowed_values:order_status:delivered,shipped,...` | membership |
| `ref_exists` | `ref_exists:product_id:dim_product` | FK resolves in the warehouse |
| `unique_key` | `unique_key:order_id+order_item_id` | business key is unique |

An unknown check **fails loudly** rather than silently passing, so a typo cannot create a false green.

## 5. Reliability properties

| Property | Mechanism |
| --- | --- |
| Idempotent ingestion | SHA-256 of the upload is stored on `ops.ingest_batch`; an identical file returns the original batch. |
| Idempotent dimension load | `INSERT ... ON CONFLICT (business_key) DO UPDATE` |
| Idempotent fact load | `NOT EXISTS` on the business key before insert |
| Re-runnable pipelines | Every stage is a set-based SQL statement; running the master pipeline twice loads 0 additional rows. |
| Nothing is silently dropped | Rejected rows are written to `ops.etl_rejects` with the raw payload. |
| Failures are visible | `ops.etl_run_log.status='failed'` + `error_message` + `log_output`; the UI surfaces them. |
| Bounded resource use | Uploads stream row by row and flush in 1 000-row batches; size and row limits are enforced. |
| No secret leakage | The error handler never returns stack traces; `/settings` never returns connection strings or keys. |

## 6. Request path (API)

```
Client → CORS → request-logging middleware (x-request-id, x-response-time-ms)
       → router → service → SQLAlchemy session → PostgreSQL
       → error handler (AppError → {"error":{code,message,details}})
```

## 7. Deployment shape

| Component | Local dev | Notes for a real deployment |
| --- | --- | --- |
| PostgreSQL | Docker container, port 5432 | Managed instance; enable backups and PITR |
| API | `uvicorn` on 8020 | Container behind a reverse proxy; add auth, rate limiting, TLS |
| UI | `next start` on 3000 | Static/edge hosting or a container; set `NEXT_PUBLIC_API_BASE` |
| Scheduling | Manual / cron | Airflow, Dagster or Carte for real orchestration |
| Secrets | `.env` (git-ignored) | A secret manager, never a file in the image |
