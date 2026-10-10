"""Warehouse catalogue: dimensions, facts, lineage and DDL introspection."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db
from ..errors import NotFoundError

router = APIRouter(tags=["warehouse"])

TABLES = [
    ("warehouse", "dim_date", "dimension"),
    ("warehouse", "dim_customer", "dimension"),
    ("warehouse", "dim_product", "dimension"),
    ("warehouse", "dim_seller", "dimension"),
    ("warehouse", "dim_geography", "dimension"),
    ("warehouse", "fact_order_items", "fact"),
    ("warehouse", "fact_payments", "fact"),
    ("staging", "stg_order_items", "staging"),
    ("staging", "stg_customers", "staging"),
    ("staging", "stg_products", "staging"),
    ("staging", "stg_sellers", "staging"),
    ("staging", "stg_payments", "staging"),
]


@router.get("/warehouse/tables")
def tables(db: Session = Depends(get_db)):
    items = []
    for schema, table, kind in TABLES:
        try:
            count = db.execute(text(f'SELECT count(*) FROM {schema}.{table}')).scalar_one()
        except Exception:  # noqa: BLE001
            db.rollback()
            count = None
        cols = db.execute(text("""
            SELECT count(*) FROM information_schema.columns
            WHERE table_schema = :s AND table_name = :t
        """), {"s": schema, "t": table}).scalar_one()
        items.append({"schema": schema, "table": table, "kind": kind, "rows": count, "columns": cols})
    return {"items": items}


@router.get("/warehouse/tables/{schema}/{table}")
def table_detail(schema: str, table: str, limit: int = Query(50, ge=1, le=200), db: Session = Depends(get_db)):
    known = {(s, t) for s, t, _ in TABLES}
    if (schema, table) not in known:
        raise NotFoundError(f"Table {schema}.{table} is not part of the RetailFlow warehouse")

    columns = [dict(r) for r in db.execute(text("""
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = :s AND table_name = :t ORDER BY ordinal_position
    """), {"s": schema, "t": table}).mappings()]

    comment = db.execute(text("""
        SELECT obj_description((:s || '.' || :t)::regclass, 'pg_class')
    """), {"s": schema, "t": table}).scalar()

    constraints = [dict(r) for r in db.execute(text("""
        SELECT con.conname AS name, con.contype AS type,
               pg_get_constraintdef(con.oid) AS definition
        FROM pg_constraint con
        JOIN pg_class c ON c.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = :s AND c.relname = :t ORDER BY con.contype, con.conname
    """), {"s": schema, "t": table}).mappings()]

    indexes = [dict(r) for r in db.execute(text("""
        SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = :s AND tablename = :t ORDER BY indexname
    """), {"s": schema, "t": table}).mappings()]

    rows = [dict(r) for r in db.execute(text(f'SELECT * FROM {schema}.{table} LIMIT :lim'), {"lim": limit}).mappings()]

    return {
        "schema": schema,
        "table": table,
        "comment": comment,
        "columns": columns,
        "constraints": constraints,
        "indexes": indexes,
        "sample_rows": rows,
    }


@router.get("/warehouse/lineage")
def lineage():
    return {
        "nodes": [
            {"id": "source.csv", "label": "Source CSV / API", "kind": "source"},
            {"id": "staging", "label": "staging.stg_*", "kind": "staging"},
            {"id": "validate", "label": "Validation + DQ rules", "kind": "process"},
            {"id": "dims", "label": "warehouse.dim_*", "kind": "dimension"},
            {"id": "facts", "label": "warehouse.fact_*", "kind": "fact"},
            {"id": "views", "label": "analytics.v_*", "kind": "view"},
            {"id": "api", "label": "RetailFlow API", "kind": "consumer"},
            {"id": "bi", "label": "Power BI / Next.js", "kind": "consumer"},
        ],
        "edges": [
            {"from": "source.csv", "to": "staging"},
            {"from": "staging", "to": "validate"},
            {"from": "validate", "to": "dims"},
            {"from": "validate", "to": "facts"},
            {"from": "dims", "to": "facts"},
            {"from": "facts", "to": "views"},
            {"from": "views", "to": "api"},
            {"from": "api", "to": "bi"},
        ],
    }
