"""Data quality rules, latest results and rejected records."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db
from ..errors import NotFoundError

router = APIRouter(tags=["quality"])


@router.get("/quality/rules")
def list_rules(db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT rule_id, rule_code, name, dataset, target_table, severity, description,
               expression, recommended_resolution, is_active
        FROM ops.data_quality_rules ORDER BY severity, rule_code
    """)).mappings()
    return {"items": [dict(r) for r in rows]}


_RESULT_SELECT = """
    SELECT q.result_id, r.rule_code, q.dataset, q.severity, q.status,
           (q.passed_count + q.failed_count) AS rows_checked,
           q.failed_count AS rows_failed,
           (1 - q.failure_rate) AS pass_rate,
           q.last_executed_at AS checked_at,
           q.run_id::text
    FROM ops.data_quality_results q
    JOIN ops.data_quality_rules r USING (rule_id)
"""


@router.get("/quality/results")
def list_results(
    limit: int = Query(100, ge=1, le=500),
    only_latest: bool = True,
    db: Session = Depends(get_db),
):
    if only_latest:
        sql = _RESULT_SELECT + """
            WHERE (q.rule_id, q.last_executed_at) IN (
                SELECT rule_id, max(last_executed_at) FROM ops.data_quality_results GROUP BY rule_id)
            ORDER BY q.status DESC, q.severity LIMIT :lim
        """
    else:
        sql = _RESULT_SELECT + " ORDER BY q.last_executed_at DESC LIMIT :lim"
    rows = db.execute(text(sql), {"lim": limit}).mappings()
    return {"items": [dict(r) for r in rows]}


@router.get("/quality/rejected")
def list_rejected(
    limit: int = Query(100, ge=1, le=500),
    batch_id: str | None = None,
    db: Session = Depends(get_db),
):
    params = {"lim": limit}
    clause = "1=1"
    if batch_id:
        clause = "rj.batch_id::text = :bid"
        params["bid"] = batch_id
    rows = db.execute(text(f"""
        SELECT rj.reject_id, rj.batch_id::text, rj.dataset, rj.row_number,
               rj.reason_code AS rule_code,
               coalesce(r.severity, 'medium') AS severity,
               rj.reason_detail AS reason,
               rj.raw_payload, rj.created_at
        FROM ops.etl_rejects rj
        LEFT JOIN ops.data_quality_rules r ON r.rule_code = rj.reason_code
        WHERE {clause} ORDER BY rj.reject_id DESC LIMIT :lim
    """), params).mappings()
    return {"items": [dict(r) for r in rows]}


@router.get("/quality/summary")
def quality_summary(db: Session = Depends(get_db)):
    totals = dict(db.execute(text("""
        SELECT count(*) AS rules,
               count(*) FILTER (WHERE is_active) AS active_rules
        FROM ops.data_quality_rules
    """)).mappings().one())
    latest = dict(db.execute(text("""
        SELECT count(*) AS checked,
               count(*) FILTER (WHERE q.status = 'passed') AS passed,
               count(*) FILTER (WHERE q.status = 'failed') AS failed,
               coalesce(round(avg(1 - q.failure_rate), 4), 0) AS avg_pass_rate
        FROM ops.data_quality_results q
        WHERE (q.rule_id, q.last_executed_at) IN (
            SELECT rule_id, max(last_executed_at) FROM ops.data_quality_results GROUP BY rule_id)
    """)).mappings().one())
    by_severity = [dict(r) for r in db.execute(text("""
        SELECT q.severity, count(*) AS failed
        FROM ops.data_quality_results q
        WHERE q.status = 'failed'
          AND (q.rule_id, q.last_executed_at) IN (
              SELECT rule_id, max(last_executed_at) FROM ops.data_quality_results GROUP BY rule_id)
        GROUP BY q.severity
    """)).mappings()]
    rejected = dict(db.execute(text("""
        SELECT count(*) AS total,
               count(*) FILTER (WHERE r.severity = 'critical') AS critical
        FROM ops.etl_rejects rj
        LEFT JOIN ops.data_quality_rules r ON r.rule_code = rj.reason_code
    """)).mappings().one())
    return {"rules": totals, "latest": latest, "failed_by_severity": by_severity, "rejected": rejected}


@router.get("/reconciliation")
def reconciliation(db: Session = Depends(get_db)):
    latest = [dict(r) for r in db.execute(text("""
        SELECT recon_id AS rec_id, run_id::text, NULL::text AS batch_id,
               check_code AS scope,
               source_value AS expected_value,
               target_value AS actual_value,
               difference AS variance,
               CASE WHEN source_value <> 0 THEN round(difference / source_value, 6) ELSE 0 END AS variance_pct,
               CASE WHEN source_value <> 0 THEN round(tolerance / source_value, 6) ELSE 0 END AS tolerance_pct,
               status, checked_at,
               description AS note
        FROM ops.data_reconciliation_results ORDER BY checked_at DESC LIMIT 20
    """)).mappings()]
    current = dict(db.execute(text("SELECT * FROM analytics.v_revenue_reconciliation")).mappings().one())
    return {"latest": latest, "current": current}
