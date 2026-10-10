"""ETL execution log and per-stage monitoring."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db
from ..errors import NotFoundError

router = APIRouter(tags=["runs"])


@router.get("/runs")
def list_runs(
    status: str | None = None,
    pipeline_id: int | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    where, params = ["1=1"], {"lim": limit, "off": offset}
    if status:
        where.append("r.status = :status")
        params["status"] = status
    if pipeline_id:
        where.append("r.pipeline_id = :pid")
        params["pid"] = pipeline_id
    clause = " AND ".join(where)

    total = db.execute(text(f"SELECT count(*) FROM ops.etl_run_log r WHERE {clause}"), params).scalar_one()
    rows = db.execute(text(f"""
        SELECT r.run_id::text, r.status, r.trigger_type AS triggered_by, r.started_at, r.finished_at,
               r.duration_ms, r.rows_read, r.rows_inserted AS rows_loaded, r.rows_rejected,
               r.batch_id::text, r.error_summary AS error_message, p.name AS pipeline_name, p.pipeline_type
        FROM ops.etl_run_log r JOIN app.etl_pipeline p USING (pipeline_id)
        WHERE {clause} ORDER BY r.started_at DESC NULLS LAST LIMIT :lim OFFSET :off
    """), params).mappings()
    return {"items": [dict(r) for r in rows], "total": total, "limit": limit, "offset": offset}


@router.get("/runs/{run_id}")
def get_run(run_id: str, db: Session = Depends(get_db)):
    row = db.execute(text("""
        SELECT r.run_id::text, r.status, r.trigger_type AS triggered_by, r.started_at, r.finished_at,
               r.duration_ms, r.rows_read, r.rows_inserted AS rows_loaded, r.rows_rejected,
               r.batch_id::text, r.error_summary AS error_message, r.execution_metadata AS log_output,
               p.name AS pipeline_name, p.pipeline_id
        FROM ops.etl_run_log r JOIN app.etl_pipeline p USING (pipeline_id)
        WHERE r.run_id::text = :rid
    """), {"rid": run_id}).mappings().first()
    if not row:
        raise NotFoundError(f"Run {run_id} not found")
    stages = db.execute(text("""
        SELECT stage_log_id, stage_order, stage_name, status, rows_in, rows_out,
               started_at, finished_at, duration_ms, message
        FROM ops.etl_stage_log WHERE run_id::text = :rid ORDER BY stage_order
    """), {"rid": run_id}).mappings()
    payload = dict(row)
    payload["stages"] = [dict(s) for s in stages]
    return payload


@router.get("/monitoring/summary")
def monitoring_summary(db: Session = Depends(get_db)):
    by_status = [dict(r) for r in db.execute(text("""
        SELECT status, count(*) AS runs, avg(duration_ms)::int AS avg_duration_ms
        FROM ops.etl_run_log GROUP BY status ORDER BY status
    """)).mappings()]
    daily = [dict(r) for r in db.execute(text("""
        SELECT to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS day,
               count(*) AS runs,
               count(*) FILTER (WHERE status = 'failed') AS failed
        FROM ops.etl_run_log WHERE started_at IS NOT NULL
        GROUP BY 1 ORDER BY 1 DESC LIMIT 14
    """)).mappings()]
    slowest = [dict(r) for r in db.execute(text("""
        SELECT r.run_id::text, p.name AS pipeline_name, r.duration_ms, r.started_at
        FROM ops.etl_run_log r JOIN app.etl_pipeline p USING (pipeline_id)
        WHERE r.duration_ms IS NOT NULL ORDER BY r.duration_ms DESC LIMIT 5
    """)).mappings()]
    return {"by_status": by_status, "daily": list(reversed(daily)), "slowest": slowest}
