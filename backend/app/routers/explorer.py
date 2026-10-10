"""Read-only SQL explorer.

Runs a single read-only SELECT/WITH statement inside a READ ONLY transaction, with a
statement timeout and a hard row cap. Writes are impossible: the transaction is
read-only and the statement must begin with SELECT/WITH.
"""
import re
import time

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..errors import ValidationError

router = APIRouter(tags=["explorer"])

STATEMENT_TIMEOUT_MS = 5000
MAX_ROWS = 1000
SCHEMAS = ("app", "ops", "staging", "warehouse", "analytics")

_FORBIDDEN = re.compile(
    r"\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|copy|vacuum|"
    r"reindex|cluster|comment|refresh|call|do|merge|lock|begin|commit|rollback)\b",
    re.IGNORECASE,
)


def _strip_sql(sql: str) -> str:
    """Remove comments so the guard sees the real statement."""
    sql = re.sub(r"--[^\n]*", " ", sql)
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.DOTALL)
    return sql.strip()


class QueryRequest(BaseModel):
    sql: str = Field(min_length=1, max_length=20000)
    limit: int = Field(default=200, ge=1, le=MAX_ROWS)


@router.get("/explorer/catalog")
def catalog(db: Session = Depends(get_db)):
    """Schema -> table -> columns, straight from information_schema."""
    if not getattr(get_settings(), "sql_explorer_enabled", True):
        raise ValidationError(
            "The SQL explorer is disabled in this environment.",
            details={"hint": "Set SQL_EXPLORER_ENABLED=true to enable it."},
        )
    rows = db.execute(
        text(
            """
            SELECT c.table_schema, c.table_name, c.column_name, c.data_type, c.is_nullable
            FROM information_schema.columns c
            JOIN information_schema.tables t
              ON t.table_schema = c.table_schema AND t.table_name = c.table_name
            WHERE c.table_schema IN ('app','ops','staging','warehouse','analytics')
              AND t.table_type IN ('BASE TABLE','VIEW')
            ORDER BY c.table_schema, c.table_name, c.ordinal_position
            """
        )
    ).mappings()
    tables: dict = {}
    for r in rows:
        key = (r["table_schema"], r["table_name"])
        t = tables.setdefault(
            key,
            {"schema": r["table_schema"], "table": r["table_name"], "columns": []},
        )
        t["columns"].append(
            {"name": r["column_name"], "type": r["data_type"], "nullable": r["is_nullable"] == "YES"}
        )
    return {"items": list(tables.values())}


@router.post("/explorer/query")
def run_query(body: QueryRequest, db: Session = Depends(get_db)):
    settings = get_settings()
    if not getattr(settings, "sql_explorer_enabled", True):
        raise ValidationError(
            "The SQL explorer is disabled in this environment.",
            details={"hint": "Set SQL_EXPLORER_ENABLED=true to enable it."},
        )

    stmt = _strip_sql(body.sql).rstrip(";").strip()
    if not stmt:
        raise ValidationError("Empty query.")
    if ";" in stmt:
        raise ValidationError(
            "Only one statement can run at a time.", details={"hint": "Remove the extra ';'."}
        )
    if not re.match(r"^(select|with)\b", stmt, re.IGNORECASE):
        raise ValidationError(
            "Only read-only SELECT / WITH queries are allowed.",
            details={"hint": "This explorer cannot modify data."},
        )
    if _FORBIDDEN.search(stmt):
        raise ValidationError(
            "The query contains a keyword that is not allowed in the read-only explorer."
        )

    started = time.perf_counter()
    try:
        db.execute(text("SET TRANSACTION READ ONLY"))
        db.execute(text(f"SET LOCAL statement_timeout = {STATEMENT_TIMEOUT_MS}"))
        result = db.execute(text(stmt))
        columns = list(result.keys())
        rows = result.fetchmany(body.limit + 1)
    except Exception as exc:  # noqa: BLE001 - surface the DB error to the user
        db.rollback()
        raise ValidationError(
            f"Query failed: {type(exc).__name__}", details={"detail": str(exc)[:400]}
        )

    truncated = len(rows) > body.limit
    rows = rows[: body.limit]
    elapsed = round((time.perf_counter() - started) * 1000, 1)

    def cell(v):
        if v is None or isinstance(v, (int, float, str, bool)):
            return v
        return str(v)

    return {
        "columns": columns,
        "rows": [[cell(v) for v in row] for row in rows],
        "row_count": len(rows),
        "truncated": truncated,
        "elapsed_ms": elapsed,
        "statement_timeout_ms": STATEMENT_TIMEOUT_MS,
    }
