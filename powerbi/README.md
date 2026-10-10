# RetailFlow — Power BI deliverables

## Honest status

**No `.pbix` file is shipped.** Power BI Desktop is a Windows GUI application that is not installed on the
machine where RetailFlow was built, and it cannot be driven headlessly to produce a valid report binary.
Generating a `.pbix` I could neither open nor validate would be a false deliverable.

What *is* provided is everything a Power BI developer needs to build the report in ~30 minutes, and every
artifact here is directly derived from the working PostgreSQL model:

| File | Contents |
| --- | --- |
| `data-model.md` | The exact tables, views, relationships and cardinalities to import |
| `measures.dax` | Complete, copy-pasteable DAX measures (revenue, AOV, growth, DQ, reconciliation) |
| `report-specification.md` | Page-by-page layout: visuals, fields, formatting, interactions |
| `README.md` | This file: connection steps and caveats |

## Connect

1. Install the PostgreSQL connector (Power BI Desktop ships with `Npgsql` support for PostgreSQL).
2. Get Data → **PostgreSQL database**.
3. Server: `localhost:5432` · Database: `retailflow`
4. Data connectivity: **Import** (DirectQuery is possible but the demo volumes make Import preferable).
5. Credentials: Database → username `retailflow`, password = the value of `POSTGRES_PASSWORD` in your `.env`.
6. Select the tables and views listed in `data-model.md` — import the `analytics` views, **not** the raw facts,
   for every revenue measure.

## The one modelling rule that matters

Import `analytics.v_order_items` and `analytics.v_orders` as separate tables.
**Never** relate `fact_order_items` to `fact_payments` — the grains differ (order item vs payment
transaction) and a relationship between them would multiply every measure.
`v_orders` exists precisely so Average Order Value has a correct denominator.

## Theme

Match the application tokens in `frontend/src/app/globals.css`:

| Token | Hex | Use |
| --- | --- | --- |
| Background | `#0b1020` | canvas |
| Surface | `#161f3d` | visual background |
| Border | `#263256` | separators |
| Text | `#eef2ff` | primary text |
| Muted text | `#a3adcd` | labels |
| Accent | `#4f7cff` | primary series |
| Success | `#2fbf8f` | passed / delivered |
| Warning | `#e5a13a` | warning |
| Danger | `#e5544b` | failed / rejected |

## Caveat on the numbers

The warehouse is loaded from a **deterministic synthetic fixture** (`scripts/seed_demo.py`, seed `20240617`),
not real Olist data. Any report built on it must be labelled as demo data — the same banner the web UI shows.
