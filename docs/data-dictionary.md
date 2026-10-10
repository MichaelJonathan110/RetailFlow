# RetailFlow — Data Dictionary

## Staging (`staging`)

All staging columns are `text` on purpose: coercion failures must become *reject records*, not load errors.
Every row keeps its original payload in `raw_payload` (JSONB).

| Table | Key columns | Notes |
| --- | --- | --- |
| `stg_order_items` | order_id, order_item_id, customer_id, product_id, seller_id, order_status, order_purchase_ts, price, freight_value, payment_value, customer_city, customer_state | source of `fact_order_items` |
| `stg_customers` | customer_id, customer_unique_id, customer_city, customer_state | source of `dim_customer` |
| `stg_products` | product_id, product_category, product_name | source of `dim_product` |
| `stg_sellers` | seller_id, seller_city, seller_state | source of `dim_seller` |
| `stg_payments` | order_id, payment_sequential, payment_type, payment_value | source of `fact_payments` |

Shared staging columns: `batch_id`, `row_number`, `raw_payload`, `validation_status` (`pending`/`valid`/`invalid`), `created_at`.

## Warehouse — dimensions (`warehouse`)

| Table | Key | Attributes | History |
| --- | --- | --- | --- |
| `dim_date` | `date_key` (yyyymmdd) | full_date, year, quarter, month, month_name, day, day_of_week, day_name, iso_week, is_weekend | static calendar 2016-01-01 → 2020-12-31 |
| `dim_customer` | `customer_sk` | customer_id (business key), customer_unique_id, customer_city, customer_state | **SCD Type 2**: valid_from, valid_to, is_current, version |
| `dim_product` | `product_sk` | product_id (unique), product_category, product_name | Type 1 (overwrite) |
| `dim_seller` | `seller_sk` | seller_id (unique), seller_city, seller_state | Type 1 |
| `dim_geography` | `geography_sk` | city, state (unique pair), region | static mapping |

### SCD2 guarantee on `dim_customer`

`CREATE UNIQUE INDEX uq_customer_current ON warehouse.dim_customer (customer_id) WHERE is_current;`

At most one current row per customer is enforced **by the database**, not by convention. A tracked
attribute change closes the current row (`valid_to = now()`, `is_current = false`) and opens a new row
with `version + 1`.

### State → region mapping (`dim_geography.region`)

| Region | States (UF) |
| --- | --- |
| North | AC, AP, AM, PA, RO, RR, TO |
| Northeast | AL, BA, CE, MA, PB, PE, PI, RN, SE |
| Central-West | DF, GO, MT, MS |
| Southeast | ES, MG, RJ, SP |
| South | PR, RS, SC |

## Warehouse — facts (`warehouse`)

### `fact_order_items` — grain: **one row per order item**

| Column | Type | Description |
| --- | --- | --- |
| `order_item_sk` | bigserial PK | surrogate |
| `order_id`, `order_item_id` | text, int | business key (UNIQUE together) |
| `date_key` | int FK | purchase date |
| `customer_sk`, `product_sk`, `seller_sk` | bigint FK | resolved dimensions |
| `geography_sk` | bigint FK, nullable | customer city/state |
| `order_status` | text | lower-cased status |
| `purchase_ts` | timestamptz | purchase timestamp |
| `quantity` | int | always 1 in this source |
| `price` | numeric(12,2) | item price, `>= 0` |
| `freight_value` | numeric(12,2) | freight, `>= 0` |
| `total_item_value` | numeric(12,2) | `price + freight_value` |
| `batch_id` | uuid FK | provenance |
| `loaded_at` | timestamptz | load time |

### `fact_payments` — grain: **one row per payment transaction**

| Column | Type | Description |
| --- | --- | --- |
| `payment_sk` | bigserial PK | surrogate |
| `order_id`, `payment_sequential` | text, int | business key (UNIQUE together) |
| `date_key` | int FK, nullable | from the order |
| `payment_type` | text | credit_card, boleto, voucher, debit_card |
| `payment_value` | numeric(12,2) | transaction amount |

## Analytics views (`analytics`)

| View | Grain | Use |
| --- | --- | --- |
| `v_order_items` | order item | flattened fact for BI |
| `v_orders` | **order** | correct denominator for AOV |
| `v_revenue_by_month` | year-month | trend |
| `v_revenue_by_category` | category | mix |
| `v_revenue_by_region` | region + state | geography |
| `v_top_products` | product | best sellers |
| `v_order_status_distribution` | status | fulfilment |
| `v_payment_methods` | payment type | payment mix |
| `v_revenue_reconciliation` | single row | totals that must agree |

## Operations (`ops`)

| Table | Purpose |
| --- | --- |
| `ingest_batch` | one row per uploaded file: checksum, row/valid/invalid counts, status |
| `etl_run_log` | one row per pipeline execution: status, timings, row counts, error, log |
| `etl_stage_log` | one row per stage of a run: rows in/out, duration, message |
| `etl_rejects` | quarantined rows: `reason_code`, severity (joined), `reason_detail`, raw payload |
| `data_quality_rules` | rule catalogue (expression, severity, recommended resolution) |
| `data_quality_results` | per-rule outcome: `passed_count`, `failed_count`, `failure_rate`, status |
| `data_reconciliation_results` | `check_code`, source vs target, difference, tolerance, status (matched/mismatch/skipped) |

## Application (`app`)

| Table | Purpose |
| --- | --- |
| `data_source` | registered sources |
| `etl_pipeline` | pipeline definitions, engine, target, executability |
| `pipeline_stage` | ordered stage definitions |
| `app_setting` | settings; `is_ui_editable=false` marks environment-controlled keys |

## Canonical enumerations

- `order_status`: delivered, shipped, canceled, unavailable, invoiced, processing, created, approved
- `payment_type`: credit_card, boleto, voucher, debit_card
- `severity`: critical, high, medium, low
- `quality status`: passed, warning, failed
- `run status`: running, completed, failed
