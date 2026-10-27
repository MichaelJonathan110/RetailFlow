"""ETL pipeline definitions, stages and execution."""
from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db
from ..errors import NotFoundError, ValidationError
from ..services import runner

router = APIRouter(tags=["pipelines"])


class RunRequest(BaseModel):
    triggered_by: str = "manual-ui"
    batch_id: str | None = None


@router.get("/pipelines")
def list_pipelines(db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT p.pipeline_id, p.name, p.description, p.pipeline_type, p.target_table,
               p.engine, (p.is_executable AND p.pipeline_type <> 'ingestion') AS is_executable, p.is_active,
               (SELECT count(*) FROM app.pipeline_stage s WHERE s.pipeline_id = p.pipeline_id) AS stages,
               (SELECT count(*) FROM ops.etl_run_log r WHERE r.pipeline_id = p.pipeline_id) AS runs,
               (SELECT max(r.started_at) FROM ops.etl_run_log r WHERE r.pipeline_id = p.pipeline_id) AS last_run_at
        FROM app.etl_pipeline p ORDER BY p.pipeline_id
    """)).mappings()
    return {"items": [dict(r) for r in rows]}


@router.get("/pipelines/{pipeline_id}")
def get_pipeline(pipeline_id: int, db: Session = Depends(get_db)):
    row = db.execute(text("""
        SELECT pipeline_id, name, description, pipeline_type, target_table, engine,
               (is_executable AND pipeline_type <> 'ingestion') AS is_executable, is_active, created_at
        FROM app.etl_pipeline WHERE pipeline_id = :pid
    """), {"pid": pipeline_id}).mappings().first()
    if not row:
        raise NotFoundError(f"Pipeline {pipeline_id} not found")
    stages = db.execute(text("""
        SELECT stage_id, stage_order, stage_name, stage_kind, description,
               true AS is_active
        FROM app.pipeline_stage WHERE pipeline_id = :pid ORDER BY stage_order
    """), {"pid": pipeline_id}).mappings()
    payload = dict(row)
    payload["stages"] = [dict(s) for s in stages]
    return payload


@router.get("/pipelines/{pipeline_id}/runs")
def pipeline_runs(pipeline_id: int, limit: int = 20, db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT run_id::text, status, started_at, finished_at, rows_read,
               rows_inserted AS rows_loaded, rows_rejected, error_summary AS error_message,
               trigger_type AS triggered_by, duration_ms
        FROM ops.etl_run_log WHERE pipeline_id = :pid ORDER BY started_at DESC NULLS LAST LIMIT :lim
    """), {"pid": pipeline_id, "lim": limit}).mappings()
    return {"items": [dict(r) for r in rows]}


@router.post("/pipelines/{pipeline_id}/run", status_code=201)
def run_pipeline_endpoint(pipeline_id: int, body: RunRequest | None = None, db: Session = Depends(get_db)):
    # RUNNOW_FIX: the UI posts without a JSON body; fall back to defaults.
    body = body or RunRequest()
    """Execute a pipeline synchronously and return the completed run record.

    Synchronous execution is deliberate: the UI needs the real outcome (rows
    loaded, stage timings, failures) to display, not a fire-and-forget receipt.
    """
    row = db.execute(text("""
        SELECT pipeline_id, name, is_executable, engine, pipeline_type FROM app.etl_pipeline WHERE pipeline_id = :pid
    """), {"pid": pipeline_id}).mappings().first()
    if not row:
        raise NotFoundError(f"Pipeline {pipeline_id} not found")
    if not row["is_executable"]:
        raise ValidationError(
            f"Pipeline '{row['name']}' is a design artifact for {row['engine']} and is not "
            "executable through the RetailFlow API.",
            details={"pipeline_id": pipeline_id, "engine": row["engine"],
                     "hint": "Run it with Pentaho Data Integration (Spoon/Carte)."},
        )

    if row["pipeline_type"] == "ingestion":
        raise ValidationError(
            "CSV ingestion runs when a file is uploaded, not from Run now.",
            details={"pipeline_id": pipeline_id,
                     "hint": "Upload the CSV on the Ingestion page; then run the Master Pipeline."},
        )
    kind = _kind_for_name(row["name"])
    return runner.run_pipeline(db, kind, triggered_by=body.triggered_by, batch_id=body.batch_id)


def _kind_for_name(name: str) -> str:
    mapping = {
        "Dimension Load (SCD2)": "dimensions",
        "Fact Load (Order Items)": "facts",
        "Data Quality Checks": "quality",
        "Revenue Reconciliation": "reconciliation",
        "RetailFlow Master Pipeline": "master",
    }
    if name not in mapping:
        raise ValidationError(f"Pipeline '{name}' has no executable implementation")
    return mapping[name]
