# Pentaho Data Integration artifacts

## Honest status — read this first

Pentaho Data Integration (Spoon) and Carte are **not installed on the machine where RetailFlow was built**,
and were not executed. These artifacts are therefore **authored and XML-validated, not run**.

They exist because the brief asks for Pentaho ETL orchestration, and because a data-engineering portfolio
should show that the same logical pipeline can be expressed in a real ETL tool — not only in Python.

What is verified here: the files are well-formed XML, use the documented `<transformation>`/`<job>`
structure, and reference the same tables, columns and rules as the working Python implementation.

What is **not** verified: that Spoon opens them without complaint, or that they run green. Treat them as a
faithful design artifact that a Pentaho engineer would review, not as a tested job. If you have Spoon,
import the `.kjb` and run it; the connection is named `RetailFlow-PostgreSQL`.

## Files

| File | Type | Purpose |
| --- | --- | --- |
| `01_extract_order_items.ktr` | Transformation | Read `sample-data/order_items.csv` |
| `02_validate_order_items.ktr` | Transformation | Apply the type/null/key checks, split valid vs reject |
| `03_load_dimensions.ktr` | Transformation | Upsert `dim_product`, `dim_seller`, `dim_customer` (SCD2) |
| `04_load_fact_order_items.ktr` | Transformation | Insert into `warehouse.fact_order_items` |
| `05_load_payments.ktr` | Transformation | Insert into `warehouse.fact_payments` |
| `06_data_quality_and_reconciliation.ktr` | Transformation | Run DQ + revenue reconciliation SQL |
| `master_pipeline.kjb` | Job | Orchestrate 01 → 06 in order |

## Connection

| Property | Value |
| --- | --- |
| Name | `RetailFlow-PostgreSQL` |
| Type | PostgreSQL |
| Host | `localhost` (or the Docker host) |
| Port | `5432` |
| Database | `retailflow` |
| Username | `retailflow` |
| Password | **not stored in these files** — set it in Spoon's `kettle.properties` or the connection dialog |

No credentials are committed. The `.ktr` files reference the connection by name only.

## Running with Spoon

1. Start the database: `docker compose up -d postgres`
2. Apply the schema: `bash scripts/init_db.sh`
3. Open Spoon → File → Open → `pentaho/master_pipeline.kjb`
4. Create the `RetailFlow-PostgreSQL` connection with your password.
5. Run the job.

The job performs the same logical steps as the Python pipeline, in the same order, against the same tables.
The RetailFlow API treats the Pentaho pipeline as **non-executable** (`is_executable = false`) and the UI
marks it as `External` — it will not pretend to run it.
