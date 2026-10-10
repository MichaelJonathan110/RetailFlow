"""Alert Center: rule-based operational alerts computed from real ops data.

Every alert is derived from tables the platform already writes (run log, quality
results, rejects, ingest batches). Nothing is fabricated: if the tables are empty,
the response says so explicitly.
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db

router = APIRouter(tags=["alerts"])

# Rule catalogue surfaced to the UI so thresholds are inspectable, not magic.
RULES = [
    {
        "code": "PIPELINE_FAILED",
        "name": "Pipeline run failed",
        "severity": "critical",
        "threshold": "any failed run in the last 24h",
        "source": "ops.etl_run_log",
    },
    {
        "code": "DQ_BREACH",
        "name": "Data-quality rule breached",
        "severity": "high",
        "threshold": "failure_rate > 0 with status = failed",
        "source": "ops.data_quality_results",
    },
    {
        "code": "REJECT_RATE",
        "name": "Reject rate above tolerance",
        "severity": "medium",
        "threshold": "rejected_count / row_count > 5%",
        "source": "ops.ingest_batch",
    },
    {
        "code": "RECON_MISMATCH",
        "name": "Reconciliation mismatch",
        "severity": "high",
        "threshold": "status = failed",
        "source": "ops.data_reconciliation_results",
    },
    {
        "code": "STALE_DATA",
        "name": "Warehouse table is stale",
        "severity": "medium",
        "threshold": "no fact load in the last 48h",
        "source": "warehouse.fact_*",
    },
]


@router.get("/alerts/rules")
def alert_rules():
    return {"items": RULES}


@router.get("/alerts")
def list_alerts(limit: int = Query(100, ge=1, le=500), db: Session = Depends(get_db)):
    items: list[dict] = []

    failed_runs = db.execute(text("""
        SELECT r.run_id::text, r.started_at, r.finished_at, r.rows_rejected,
               r.error_summary, p.name AS pipeline_name, p.pipeline_type
        FROM ops.etl_run_log r JOIN app.etl_pipeline p USING (pipeline_id)
        WHERE r.status = 'failed'
        ORDER BY r.started_at DESC NULLS LAST LIMIT :lim
    """), {"lim": limit}).mappings()
    for r in failed_runs:
        items.append({
            "rule_code": "PIPELINE_FAILED",
            "severity": "critical",
            "title": f"Pipeline failed: {r['pipeline_name']}",
            "detail": r["error_summary"] or "Run ended in a failed state.",
            "subject": r["pipeline_name"],
            "occurred_at": r["started_at"],
            "metric": r["rows_rejected"],
            "link": f"/monitoring?run={r['run_id']}",
        })

    breaches = db.execute(text("""
        SELECT d.result_id, d.dataset, d.severity, d.failed_count, d.failure_rate,
               d.status, d.last_executed_at, r.rule_code, r.name AS rule_name
        FROM ops.data_quality_results d LEFT JOIN ops.data_quality_rules r USING (rule_id)
        WHERE d.status = 'failed' AND coalesce(d.failed_count, 0) > 0
        ORDER BY d.failure_rate DESC NULLS LAST LIMIT :lim
    """), {"lim": limit}).mappings()
    for r in breaches:
        rate = r["failure_rate"]
        items.append({
            "rule_code": "DQ_BREACH",
            "severity": r["severity"] or "high",
            "title": f"DQ breach: {r['rule_name'] or r['rule_code'] or r['dataset']}",
            "detail": f"{r['failed_count']} row(s) failed in dataset '{r['dataset']}'.",
            "subject": r["dataset"],
            "occurred_at": r["last_executed_at"],
            "metric": float(rate) if rate is not None else None,
            "link": "/quality",
        })

    rejects = db.execute(text("""
        SELECT batch_id::text, dataset, file_name, row_count, rejected_count, created_at
        FROM ops.ingest_batch
        WHERE row_count > 0 AND rejected_count::float / row_count > 0.05
        ORDER BY created_at DESC LIMIT :lim
    """), {"lim": limit}).mappings()
    for r in rejects:
        pct = round(100.0 * r["rejected_count"] / r["row_count"], 2)
        items.append({
            "rule_code": "REJECT_RATE",
            "severity": "medium",
            "title": f"High reject rate: {r['dataset']}",
            "detail": f"{r['rejected_count']} of {r['row_count']} rows rejected ({pct}%) in {r['file_name']}.",
            "subject": r["dataset"],
            "occurred_at": r["created_at"],
            "metric": pct,
            "link": f"/ingestion?batch={r['batch_id']}",
        })

    recon = db.execute(text("""
        SELECT recon_id, check_code, description, source_value, target_value,
               difference, status, checked_at
        FROM ops.data_reconciliation_results
        WHERE status = 'failed'
        ORDER BY checked_at DESC NULLS LAST LIMIT :lim
    """), {"lim": limit}).mappings()
    for r in recon:
        items.append({
            "rule_code": "RECON_MISMATCH",
            "severity": "high",
            "title": f"Reconciliation mismatch: {r['check_code']}",
            "detail": r["description"] or "Source and target values disagree.",
            "subject": r["check_code"],
            "occurred_at": r["checked_at"],
            "metric": float(r["difference"]) if r["difference"] is not None else None,
            "link": "/reconciliation",
        })

    order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
    items.sort(key=lambda a: (order.get(a["severity"], 9), str(a["occurred_at"] or "")), reverse=False)
    items.sort(key=lambda a: order.get(a["severity"], 9))

    counts = {k: sum(1 for a in items if a["severity"] == k) for k in ("critical", "high", "medium", "low")}
    return {"items": items, "total": len(items), "counts": counts}
