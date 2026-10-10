# RetailFlow — Power BI Report Specification

Theme: dark (`#0b1020` canvas, `#161f3d` surfaces). Font: Segoe UI. All pages carry the demo-data note.

---

## Page 1 — Executive Overview

**Purpose:** one screen a stakeholder can read in 10 seconds.

| Visual | Type | Fields | Notes |
| --- | --- | --- | --- |
| Revenue | Card | `[Total Revenue]` | accent colour |
| Orders | Card | `[Total Orders]` | |
| Average Order Value | Card | `[Average Order Value]` | subtitle: "from v_orders — per order" |
| Revenue MoM % | KPI | value `[Total Revenue]`, trend `[Revenue MoM %]` | conditional colour on sign |
| Revenue trend | Line chart | axis `dim_date[year_month]`, values `[Total Revenue]`, `[Revenue 3M Rolling]` | |
| Revenue by category | Bar chart | axis `dim_product[product_category]`, values `[Total Revenue]` | sorted desc, top 10 |
| Revenue by region | Map / filled map | location `dim_geography[region]`, values `[Total Revenue]` | |
| Data-quality summary | Multi-row card | `[DQ Rules Checked]`, `[DQ Rules Failed]`, `[DQ Average Pass Rate]`, `[Rejected Records]` | |
| Reconciliation banner | Card | `[Reconciliation Status]` | background via `[Revenue Colour]` |

Interactions: the trend line cross-filters the category bar; the region map does not filter (Edit interactions → None).

---

## Page 2 — Sales Performance

| Visual | Type | Fields |
| --- | --- | --- |
| Revenue and orders by month | Combo (line + column) | axis `dim_date[year_month]`; column `[Total Revenue]`; line `[Total Orders]` on secondary axis |
| Top 10 products | Table | `dim_product[product_name]`, `[Total Revenue]`, `[Total Units]`, `[Category Rank]` |
| Top 10 sellers | Bar chart | axis `dim_seller[seller_id]`, values `[Total Revenue]` |
| Order status | Donut | legend `v_order_items[order_status]`, values `[Total Orders]` |
| Fulfilment KPIs | Cards | `[Delivered Rate]`, `[Cancellation Rate]` |
| Year / category slicers | Slicers | `dim_date[year]`, `dim_product[product_category]` |

---

## Page 3 — Customer Analytics

| Visual | Type | Fields |
| --- | --- | --- |
| Customers | Card | `[Customers]` |
| Repeat rate | Card | `[Repeat Rate]` |
| Revenue by customer state | Bar chart | axis `v_order_items[customer_state]`, values `[Total Revenue]` |
| Revenue by region | Treemap | `v_order_items[customer_region]`, `[Total Revenue]` |
| Top customers | Table | `v_order_items[customer_unique_id]`, `[Total Orders]`, `[Total Revenue]`, `[Average Order Value]` |
| Customer SCD2 note | Text box | "`dim_customer` is SCD Type 2. Filter `is_current = true` for current-state views; remove the filter to analyse history." |

---

## Page 4 — Payments & Reconciliation

| Visual | Type | Fields |
| --- | --- | --- |
| Payment mix | Donut | legend `fact_payments[payment_type]`, values `[Payment Value]` |
| Payment share | Bar chart | `fact_payments[payment_type]`, `[Payment Share of Total]` |
| Item revenue | Card | `[Reconciled Item Revenue]` |
| Payment revenue | Card | `[Reconciled Payment Revenue]` |
| Variance | Card | `[Reconciliation Variance]`, colour via `[Revenue Colour]` |
| Variance % vs tolerance | KPI | `[Reconciliation Variance %]` vs `[Reconciliation Tolerance %]` |
| Reconciliation history | Table | `data_reconciliation_results[checked_at]`, `check_code` (scope), `source_value` (expected), `target_value` (actual), `difference` (variance), `status` |
| Grain warning | Text box | "`fact_order_items` (order item) and `fact_payments` (payment transaction) are never joined — totals are compared as aggregates." |

---

## Page 5 — Data Quality

| Visual | Type | Fields |
| --- | --- | --- |
| Pass rate gauge | Gauge | value `[DQ Average Pass Rate]`, target 0.98 |
| Rules by status | Stacked bar | axis `data_quality_results[dataset]`, legend `status`, values `[DQ Rules Checked]` |
| Failures by severity | Bar chart | `data_quality_results[severity]`, `[DQ Failed Rows]` |
| Rule detail | Matrix | rows `data_quality_rules[rule_code]`, columns `data_quality_results[last_executed_at]` (month), values `[DQ Average Pass Rate]` |
| Rejected records | Table | `etl_rejects[reason_code]`, `severity`, `reason_detail`, `row_number`, `created_at` |
| Critical rejects | Card | `[Critical Rejected Records]` |

---

## Page 6 — Pipeline Operations

| Visual | Type | Fields |
| --- | --- | --- |
| Runs | Card | `[ETL Runs]` |
| Failures | Card | `[ETL Failures]` |
| Success rate | Card | `[ETL Success Rate]` |
| Avg duration | Card | `[Average Run Duration (s)]` |
| Runs over time | Column chart | axis `etl_run_log[started_at]` (day), values `[ETL Runs]`, legend `status` |
| Run detail | Table | `etl_pipeline[name]`, `etl_run_log[started_at]`, `finished_at`, `duration_ms`, `rows_read`, `rows_inserted` (loaded), `rows_rejected`, `status` |
| Failure detail | Table | filter `status = "failed"`; show `error_summary` |

---

## Cross-page requirements

- **Demo-data label** on every page (the warehouse is synthetic).
- **Last refresh** card on pages 1 and 6 (`MAX(etl_run_log[finished_at])`).
- No visual shows a measure it cannot compute: empty states must be explicit ("no data loaded yet"), never 0-with-a-chart.
- Bookmark: "Reconciliation only" to isolate the reconciliation visuals on page 4.
- Drill-through: from any `product_category` to page 2 filtered by that category.
