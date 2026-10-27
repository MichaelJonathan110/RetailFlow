"""Retail data source registry."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db
from ..errors import NotFoundError, ValidationError

router = APIRouter(tags=["sources"])


@router.get("/sources")
def list_sources(db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT s.source_id, s.name, s.source_type, s.dataset, s.description,
               s.location_hint, s.status, s.created_at,
               (SELECT count(*) FROM ops.ingest_batch b
                WHERE b.source_id = s.source_id
                   OR (b.source_id IS NULL AND b.dataset = s.dataset)) AS batches  -- DEMOFIX
        FROM app.data_source s ORDER BY s.source_id
    """)).mappings()
    items = [dict(r) for r in rows]
    return {"items": items, "total": len(items)}


@router.get("/sources/{source_id}")
def get_source(source_id: int, db: Session = Depends(get_db)):
    row = db.execute(text("""
        SELECT source_id, name, source_type, dataset, description, location_hint, status, created_at
        FROM app.data_source WHERE source_id = :sid
    """), {"sid": source_id}).mappings().first()
    if not row:
        raise NotFoundError(f"Source {source_id} not found")
    return dict(row)


@router.get("/sources/{source_id}/batches")
def source_batches(source_id: int, limit: int = Query(25, ge=1, le=200), db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT b.batch_id::text, b.dataset, b.file_name, b.row_count,
               b.accepted_count AS valid_count,
               b.rejected_count AS invalid_count,
               b.file_size_bytes AS size_bytes,
               b.status, b.created_at AS received_at, b.completed_at,
               s.name AS source_name
        FROM ops.ingest_batch b LEFT JOIN app.data_source s USING (source_id)
        WHERE b.source_id = :sid
           OR (b.source_id IS NULL AND b.dataset = (SELECT dataset FROM app.data_source WHERE source_id = :sid))
        ORDER BY b.created_at DESC LIMIT :lim
    """), {"sid": source_id, "lim": limit}).mappings()
    return {"items": [dict(r) for r in rows]}
