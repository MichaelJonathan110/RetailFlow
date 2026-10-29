# RetailFlow - Pentaho Data Integration artifacts

These files are the **Pentaho engine** version of the RetailFlow Master Pipeline. They run the
same SQL as the web app's native runner (`backend/app/services/transform.py`, `runner.py`,
`reconciliation.py`), against the same PostgreSQL database, and write the same ops tables, so a
Pentaho run shows up on the Runs / Monitoring / Quality / Reconciliation pages next to native runs
(`engine = pentaho`, `trigger_type = pentaho`).

Tested with PDI 11.0.0.0-237 (`E:\data-integration`) via Kitchen against the local DB.

| File | Stage (web runner) | What it does |
|---|---|---|
| `master_pipeline.kjb` | RetailFlow Master Pipeline | START -> open run log -> 01..05 -> close run (succeeded) -> Success. Any failure -> mark run failed -> Abort |
| `01_extract_staging.ktr` | 1 Extract from staging | Profiles valid/invalid rows in the 5 staging tables |
| `02_load_dimensions.ktr` | 2 Load dimensions (SCD2) | dim_product upsert, dim_seller, dim_geography, dim_customer SCD Type 2 (insert / close changed / open version+1) |
| `03_load_facts.ktr` | 3 Load fact tables | fact_order_items (grain: order item), fact_payments (grain: payment); idempotent |
| `04_data_quality.ktr` | 4 Execute data quality rules | 12 active rules -> ops.data_quality_results (passed / warning / failed) |
| `05_reconciliation.ktr` | 5 Reconcile totals | revenue_total and order_count, 0.5% tolerance -> ops.data_reconciliation_results |

Star schema: 5 dimensions (`dim_date`, `dim_customer`, `dim_product`, `dim_seller`, `dim_geography`) and
2 facts (`fact_order_items`, `fact_payments`). `dim_date` is a static calendar (2016-2020) seeded by
`database/warehouse/20_seed_reference.sql`, so no transformation loads it.

## Connection

All files use the connection `RetailFlow-PostgreSQL`. It is parameterised, so **no credentials are in
the repo**. Define these in `%USERPROFILE%\.kettle\kettle.properties` (restart Spoon after editing):

```
RF_DB_HOST=localhost
RF_DB_PORT=5434
RF_DB_NAME=retailflow
RF_DB_USER=retailflow
RF_DB_PASSWORD=<your password>
```

## Run

Spoon: `E:\data-integration\Spoon.bat` -> File -> Open -> `pentaho/master_pipeline.kjb` -> Run.

Command line:

```
cd E:\data-integration
Kitchen.bat -file=C:\Users\kohja\retailflow\pentaho\master_pipeline.kjb -level=Basic
```

A single stage can be opened/run on its own (Spoon or `Pan.bat -file=...ktr`). When run outside the
job there is no open run, so the stage log / DQ run_id simply stay empty.

## Interview walkthrough

1. Open `master_pipeline.kjb`: show the 5 stages = the same plan as the web Pipelines page; green hops =
   success path, red hops = failure path that marks the run failed in `ops.etl_run_log`.
2. Open `02_load_dimensions.ktr`: explain SCD Type 2 on `dim_customer` (3 steps: insert new, close the
   changed version with `valid_to` and `is_current = false`, open `version + 1`).
3. Open `03_load_facts.ktr`: fact grain, surrogate-key lookups, `NOT EXISTS` for idempotent re-runs.
4. Run the job, then show the new run (engine pentaho) on the web Runs page, plus Quality and
   Reconciliation results.
5. Re-run: facts insert 0 rows. That is idempotency, not a failure.

## Verified run

Kitchen run of `master_pipeline.kjb` on PDI 11.0.0.0-237 against the local DB (`localhost:5434/retailflow`):

| Stage | Status | rows in | rows out | rejected | message |
|---|---|---|---|---|---|
| 1 Extract from staging | succeeded | 2481 | 2481 | 0 | 2481 valid staging rows available |
| 2 Load dimensions (SCD2) | succeeded | 2481 | 2108 | 0 | dim_product=125, dim_seller=16, dim_geography=38, dim_customer_current=1929 (totals after Pentaho load) |
| 3 Load fact tables | succeeded | 2481 | 6873 | 0 | fact_order_items=2477, fact_payments=4396 (totals after Pentaho load) |
| 4 Execute data quality rules | succeeded | 2477 | 7 | 5 | 7/12 rules passed |
| 5 Reconcile totals | succeeded | 2 | 0 | 2 | revenue_total: source=460072.71 target=500424.43 mismatch; order_count: source=1602.00 target=1585.00 mismatch |

Reload test: deleted the facts of 25 orders (41 order items, 69 payments), re-ran the job, and the facts came back to 2477 / 4396 rows. A second run on unchanged data inserts 0 fact rows, which shows the load is idempotent.

The reconciliation `mismatch` is real. Item revenue is `price` only, while payments include freight. It is the same result the native runner shows.
