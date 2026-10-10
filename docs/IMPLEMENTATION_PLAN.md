# RetailFlow — Implementation Plan

> Living document. Tasks are marked complete only after they have been verified on this machine.
> Last verified against: Windows 11 / git-bash (MSYS), Python 3.11.16, Node 24.21.0, Docker 29.8.0.

## 1. Environment findings (verified)

| Item | Result |
| --- | --- |
| OS / shell | Windows, git-bash (MSYS) |
| Python | 3.11.16 |
| Node / npm | v24.21.0 / 11.19.0 |
| Git | 2.54.0.windows.1 |
| Docker / Compose | 29.8.0 / v5.5.1 |
| PostgreSQL client (`psql`) | **not installed locally** → the database runs in Docker and all SQL is executed with `psql` *inside* the container |
| Pentaho Data Integration / Spoon | **not installed** → `.ktr`/`.kjb` artifacts are authored and validated as XML, and are explicitly labelled as not executed here |
| Power BI Desktop | **not available on this host** → PBIR/PBIT binaries cannot be authored; the DAX measures, semantic model definition and report specification are provided instead |

### Design reference

`docs/design-reference.png` was **not present** in the repository at inspection time, and no image-reading capability was available in this session.
**I have not inspected it and make no claim about its contents.** The UI was therefore designed from the written requirements using an explicit, documented token set (`frontend/src/app/globals.css`). If the image is added later, drop it at that path and the tokens can be reconciled against it.

## 2. Architecture decisions

| Decision | Rationale |
| --- | --- |
| PostgreSQL 16 in Docker | No local `psql`/server; Docker guarantees a reproducible database for anyone cloning the repo. |
| Medallion-style layering: `staging` → `warehouse` → `analytics` | Mirrors how a real retail warehouse is built; makes the ETL auditable at each hop. |
| Star schema: 5 dimensions + 2 facts | Kimball-style dimensional model. `fact_order_items` (grain: order item) and `fact_payments` (grain: payment transaction) are kept separate on purpose. |
| Facts never joined to each other in revenue queries | Joining two facts at different grains multiplies measures. Reconciliation compares *aggregates*. |
| SCD Type 2 on `dim_customer` | Demonstrates real historisation; `valid_from`/`valid_to`/`is_current`/`version` with a partial unique index guaranteeing one current row. |
| Rules stored as data (`ops.data_quality_rules.expression`) | A new check is a row, not a code change. The engine parses `<check>:<column>[:<arg>]`. |
| Rejected rows are quarantined, never dropped | `ops.etl_rejects` keeps the raw payload so a bad row can be reprocessed. |
| Idempotency via upload SHA-256 | Re-uploading the same file returns the original batch instead of duplicating rows. |
| Deterministic synthetic fixture (`SEED = 20240617`) | Every machine produces identical numbers, so screenshots, tests and docs agree. |
| Next.js 15 (App Router) + Recharts | Server-capable React with a mature charting layer; no CSS framework keeps the design tokens explicit. |
| Synchronous pipeline execution over the API | The UI needs the real outcome (rows loaded, stage timings) to display, not a fire-and-forget receipt. |

## 3. Task checklist

### Foundation
- [x] Inspect environment, toolchain, repository
- [x] Confirm shell access route and record it
- [x] Write implementation plan (this file)
- [x] `docker-compose.yml` with PostgreSQL 16 + healthcheck
- [x] `.env.example` (no real secrets)

### Database
- [x] Schemas: `app`, `ops`, `staging`, `warehouse`, `analytics`
- [x] `app`: data_source, etl_pipeline, pipeline_stage, app_setting
- [x] `ops`: ingest_batch, etl_run_log, etl_stage_log, etl_rejects, data_quality_rules, data_quality_results, data_reconciliation_results
- [x] `staging`: stg_order_items, stg_customers, stg_products, stg_sellers, stg_payments (all text + raw JSONB payload)
- [x] `warehouse`: dim_date, dim_customer (SCD2), dim_product, dim_seller, dim_geography, fact_order_items, fact_payments
- [x] Primary keys, foreign keys, check constraints, unique business keys, indexes
- [x] `analytics` views incl. `v_orders` (correct AOV denominator) and `v_revenue_reconciliation`
- [x] Reference seed: calendar 2016–2020, state→region map, settings, sources, pipelines, 12 DQ rules
- [x] `scripts/init_db.sh` — idempotent, runs `psql` inside the container

### Sample data
- [x] `scripts/seed_demo.py` — deterministic generator with injected defects
- [x] `manifest.json` recording seed, row counts and file hashes
- [x] Optional `--upload` to ingest straight into a running API

### Backend (FastAPI, `/api/v1`)
- [x] Settings, DB engine/session, structured JSON logging
- [x] Consistent error envelope (`{"error": {"code", "message", "details"}}`)
- [x] Health (with real DB probe), overview, sources, pipelines, runs, monitoring, quality, reconciliation, warehouse, analytics, settings
- [x] Ingestion: header normalisation, encoding/delimiter sniffing, streaming, per-row validation, rejects, idempotency
- [x] Rule engine parsing expression strings
- [x] Transform: dimension upserts, SCD2 versioning, idempotent fact loads
- [x] Reconciliation with explicit tolerance and recorded variance
- [x] Pipeline runner with per-stage logging

### Pentaho
- [x] 6 `.ktr` transformations + 1 master `.kjb`
- [x] `pentaho/README.md` stating honestly what is and is not executed here

### Frontend (Next.js)
- [x] Scaffold, tsconfig, design tokens, responsive shell
- [x] 10 pages wired to the real API, each with loading/error/empty states
- [x] Provenance footer on every data view
- [x] Demo-data banner

### Power BI
- [x] `powerbi/data-model.md`, `measures.dax`, `report-specification.md`, `README.md`
- [x] Honest note that no `.pbix` is shipped and why

### Quality
- [x] Backend pytest suite (unit + API + DB)
- [x] End-to-end acceptance scenario test
- [x] Frontend unit tests
- [x] `docs/testing.md`

### Delivery
- [x] `README.md`, `docs/architecture.md`, `docs/data-dictionary.md`, `docs/data-lineage.md`
- [x] `scripts/run_all.sh` — one command to bring the whole stack up
- [x] Verify the running app over HTTP

## 4. What is deliberately NOT done

- **No `.pbix` file.** Power BI Desktop is not installable/available on this host; shipping a binary I cannot open or validate would be dishonest. The semantic model, measures and report spec are complete and reproducible.
- **Pentaho artifacts are not executed.** Spoon/Carte is not installed here. The `.ktr`/`.kjb` files are valid, schema-shaped XML and are labelled accordingly in `pentaho/README.md`.
- **No authentication.** `AUTH_ENABLED=false`. This is a portfolio/demo build; a real deployment must add authn/authz before exposing it.
- **The SQL explorer is off by default** (`SQL_EXPLORER_ENABLED=false`). Arbitrary SQL from a browser is a serious liability; it is opt-in and documented.
- **No real customer data.** The fixture is synthetic by construction.
