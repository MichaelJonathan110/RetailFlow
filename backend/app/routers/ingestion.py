"""File ingestion endpoints."""
from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..errors import ValidationError
from ..services import ingestion

router = APIRouter(tags=["ingestion"])


@router.get("/ingestion/datasets")
def datasets():
    """Datasets the API can ingest, with the columns each one expects."""
    return {
        "items": [
            {"dataset": name, "columns": cols, "target_table": ingestion.DATASET_TABLES[name]}
            for name, cols in ingestion.DATASET_COLUMNS.items()
        ],
        "limits": {
            "max_upload_mb": get_settings().max_upload_mb,
            "max_rows": get_settings().max_upload_rows,
        },
    }


@router.post("/ingestion/upload", status_code=201)
async def upload(
    file: UploadFile = File(...),
    dataset: str = Form(...),
    source_id: int | None = Form(None),
    db: Session = Depends(get_db),
):
    """Upload a CSV, stage it, validate it, and record reject reasons."""
    raw = await file.read()
    if not raw:
        raise ValidationError("The uploaded file is empty")
    if source_id is not None:
        exists = db.execute(text("SELECT 1 FROM app.data_source WHERE source_id = :sid"),
                            {"sid": source_id}).scalar()
        if not exists:
            raise ValidationError(f"Unknown source_id {source_id}")
    return ingestion.ingest_csv(
        db, raw=raw, file_name=file.filename or "upload.csv", dataset=dataset, source_id=source_id,
    )


@router.get("/ingestion/batches")
def batches(limit: int = 50, db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT b.batch_id::text, b.dataset, b.file_name, b.status, b.row_count,
               b.accepted_count AS valid_count,
               b.rejected_count AS invalid_count,
               b.file_size_bytes AS size_bytes,
               b.created_at AS received_at, b.completed_at,
               s.name AS source_name
        FROM ops.ingest_batch b LEFT JOIN app.data_source s USING (source_id)
        ORDER BY b.created_at DESC LIMIT :lim
    """), {"lim": limit}).mappings()
    return {"items": [dict(r) for r in rows]}


@router.get("/ingestion/batches/{batch_id}")
def batch_detail(batch_id: str, db: Session = Depends(get_db)):
    row = db.execute(text("""
        SELECT b.batch_id::text, b.dataset, b.file_name, b.status, b.row_count,
               b.accepted_count AS valid_count,
               b.rejected_count AS invalid_count,
               b.file_size_bytes AS size_bytes,
               b.file_sha256 AS checksum,
               b.created_at AS received_at, b.completed_at, s.name AS source_name
        FROM ops.ingest_batch b LEFT JOIN app.data_source s USING (source_id)
        WHERE b.batch_id::text = :bid
    """), {"bid": batch_id}).mappings().first()
    if not row:
        from ..errors import NotFoundError
        raise NotFoundError(f"Batch {batch_id} not found")
    rejects = db.execute(text("""
        SELECT reason_code AS rule_code,
               coalesce(r.severity, 'medium') AS severity,
               count(*) AS failures
        FROM ops.etl_rejects rj
        LEFT JOIN ops.data_quality_rules r ON r.rule_code = rj.reason_code
        WHERE rj.batch_id::text = :bid
        GROUP BY rj.reason_code, r.severity ORDER BY failures DESC
    """), {"bid": batch_id}).mappings()
    payload = dict(row)
    payload["reject_breakdown"] = [dict(r) for r in rejects]
    return payload
