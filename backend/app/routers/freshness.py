"""Freshness & SLA monitor: how old is each dataset versus its SLA.

Age is measured from real timestamp columns the pipelines already populate
(batch completion, fact load time, DQ execution, run finish). No synthetic
numbers: a table with no rows reports status 'unknown'.
"""
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db

router = APIRouter(tags=["freshness"])

# dataset -> (source SQL for last-updated, SLA minutes, owner team)
TARGETS = [
    {
        "dataset": "order_items",
        "table": "warehouse.fact_order_items",
        "sla_minutes": 1440,
        "owner": "Data Engineering",
        "sql": "SELECT max(loaded_at) FROM warehouse.fact_order_items",
    },
    {
        "dataset": "payments",
        "table": "warehouse.fact_payments",
        "sla_minutes": 1440,
        "owner": "Data Engineering",
        "sql": "SELECT max(loaded_at) FROM warehouse.fact_payments",
    },
    {
        "dataset": "customers_scd2",
        "table": "warehouse.dim_customer",
        "sla_minutes": 2880,
        "owner": "MDM",
        "sql": "SELECT max(valid_from) FROM warehouse.dim_customer",
    },
    {
        "dataset": "ingestion_batches",
        "table": "ops.ingest_batch",
        "sla_minutes": 720,
        "owner": "Ingestion",
        "sql": "SELECT max(completed_at) FROM ops.ingest_batch",
    },
    {
        "dataset": "quality_results",
        "table": "ops.data_quality_results",
        "sla_minutes": 1440,
        "owner": "Data Quality",
        "sql": "SELECT max(last_executed_at) FROM ops.data_quality_results",
    },
    {
        "dataset": "etl_runs",
        "table": "ops.etl_run_log",
        "sla_minutes": 720,
        "owner": "Orchestration",
        "sql": "SELECT max(finished_at) FROM ops.etl_run_log",
    },
]


@router.get("/freshness")
def freshness(db: Session = Depends(get_db)):
    items = []
    now_row = db.execute(text("SELECT now()")).scalar()
    for t in TARGETS:
        last = None
        rows = None
        try:
            last = db.execute(text(t["sql"])).scalar()
            rows = db.execute(text(f"SELECT count(*) FROM {t['table']}")).scalar()
        except Exception:  # noqa: BLE001 - report as unknown rather than 500
            db.rollback()
        age_minutes = None
        status = "unknown"
        if last is not None:
            age_minutes = round((now_row - last).total_seconds() / 60.0, 1)
            if age_minutes <= t["sla_minutes"]:
                status = "fresh"
            elif age_minutes <= t["sla_minutes"] * 1.5:
                status = "late"
            else:
                status = "stale"
        items.append({
            "dataset": t["dataset"],
            "table": t["table"],
            "owner": t["owner"],
            "sla_minutes": t["sla_minutes"],
            "last_updated": last,
            "age_minutes": age_minutes,
            "status": status,
            "rows": rows,
        })
    fresh = sum(1 for i in items if i["status"] == "fresh")
    return {
        "items": items,
        "summary": {
            "fresh": fresh,
            "late": sum(1 for i in items if i["status"] == "late"),
            "stale": sum(1 for i in items if i["status"] == "stale"),
            "unknown": sum(1 for i in items if i["status"] == "unknown"),
            "checked_at": now_row,
        },
    }
