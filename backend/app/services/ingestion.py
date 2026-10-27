"""CSV ingestion: validate, stage, reject, log.

Design notes
------------
* The whole file is streamed row by row; memory stays flat for large uploads.
* Every row is landed in staging as text with its raw payload, so nothing is lost
  even when a later validation step rejects it.
* Idempotency: the SHA-256 of the uploaded bytes is recorded on ops.ingest_batch.
  Re-uploading identical bytes returns the previous batch instead of duplicating rows.
"""
import csv
import hashlib
import io
import json
import logging
import time
import uuid
from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..errors import ValidationError
from decimal import Decimal

from .rules import Rule, _to_timestamp, build_rules

log = logging.getLogger("retailflow.ingestion")

DATASET_TABLES = {
    "order_items": "staging.stg_order_items",
    "customers": "staging.stg_customers",
    "products": "staging.stg_products",
    "sellers": "staging.stg_sellers",
    "payments": "staging.stg_payments",
}

DATASET_COLUMNS = {
    "order_items": [
        "order_id", "order_item_id", "customer_id", "product_id", "seller_id",
        "order_status", "order_purchase_ts", "price", "freight_value",
        "payment_value", "customer_city", "customer_state",
    ],
    "customers": ["customer_id", "customer_unique_id", "customer_city", "customer_state"],
    "products": ["product_id", "product_category", "product_name"],
    "sellers": ["seller_id", "seller_city", "seller_state"],
    "payments": ["order_id", "payment_sequential", "payment_type", "payment_value"],
}

# Tolerant header aliases so real exports do not need pre-renaming.
HEADER_ALIASES = {
    "order_item_id": {"order_item_id", "orderitemid", "item_id", "order_item"},
    "order_id": {"order_id", "orderid"},
    "customer_id": {"customer_id", "customerid"},
    "product_id": {"product_id", "productid"},
    "seller_id": {"seller_id", "sellerid"},
    "order_status": {"order_status", "status"},
    "order_purchase_ts": {"order_purchase_timestamp", "order_purchase_ts", "purchase_ts", "order_date"},
    "price": {"price", "unit_price", "item_price"},
    "freight_value": {"freight_value", "freight", "shipping"},
    "payment_value": {"payment_value", "payment_amount", "value"},
    "customer_city": {"customer_city", "city"},
    "customer_state": {"customer_state", "state", "uf"},
    "customer_unique_id": {"customer_unique_id", "customer_unique"},
    "product_category": {"product_category_name", "product_category", "category"},
    "product_name": {"product_name", "name"},
    "seller_city": {"seller_city"},
    "seller_state": {"seller_state"},
    "payment_sequential": {"payment_sequential", "payment_seq", "sequential"},
    "payment_type": {"payment_type", "payment_method"},
}


def _normalise_header(name: str) -> str:
    key = (name or "").strip().lstrip("\ufeff").lower().replace(" ", "_").replace("-", "_")
    for canonical, aliases in HEADER_ALIASES.items():
        if key in aliases:
            return canonical
    return key


@dataclass
class IngestStats:
    rows_read: int = 0
    rows_staged: int = 0
    rows_invalid: int = 0
    rejects: list = field(default_factory=list)
    rule_stats: dict = field(default_factory=dict)


def detect_encoding(raw: bytes) -> str:
    if raw[:3] == bytes((0xEF, 0xBB, 0xBF)):
        return "utf-8-sig"
    for enc in ("utf-8", "latin-1"):
        try:
            raw.decode(enc)
            return enc
        except UnicodeDecodeError:
            continue
    return "latin-1"


def detect_delimiter(sample: str) -> str:
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        return ","


def load_reference_ids(db: Session) -> dict:
    """Reference sets used by ref_exists rules. Read once per batch, not per row."""
    refs: dict[str, set] = {}
    for table, col in (("dim_product", "product_id"), ("dim_seller", "seller_id")):
        try:
            rows = db.execute(text(f"SELECT {col} FROM warehouse.{table}")).scalars().all()
            refs[table] = {str(r).strip() for r in rows if r is not None}
        except Exception:  # noqa: BLE001
            db.rollback()
            refs[table] = set()
    return refs


def find_duplicate_batch(db: Session, checksum: str, dataset: str) -> dict | None:
    row = db.execute(text("""
        SELECT batch_id::text, file_name, row_count, accepted_count, rejected_count,
               status, created_at
        FROM ops.ingest_batch WHERE file_sha256 = :ck AND dataset = :ds
        ORDER BY created_at DESC LIMIT 1
    """), {"ck": checksum, "ds": dataset}).mappings().first()
    return dict(row) if row else None


def create_batch(db: Session, *, source_id: int | None, dataset: str, file_name: str,
                 checksum: str, size_bytes: int, run_id: uuid.UUID | None) -> uuid.UUID:
    batch_id = uuid.uuid4()
    db.execute(text("""
        INSERT INTO ops.ingest_batch (batch_id, source_id, dataset, file_name, file_sha256,
                                      file_size_bytes, status)
        VALUES (:bid, :sid, :ds, :fn, :ck, :sz, 'received')
    """), {"bid": batch_id, "sid": source_id, "ds": dataset, "fn": file_name,
           "ck": checksum, "sz": size_bytes})
    return batch_id


def ingest_csv(db: Session, *, raw: bytes, file_name: str, dataset: str,
               source_id: int | None, run_id: uuid.UUID | None = None,
               trigger: str = "api") -> dict:
    """Stage a CSV; if anything fails mid-way, remove the half-created batch so a
    corrected re-upload of the same bytes is not mistaken for an idempotent replay."""
    try:
        return _ingest_csv_impl(db, raw=raw, file_name=file_name, dataset=dataset,
                                source_id=source_id, run_id=run_id, trigger=trigger)
    except Exception:
        db.rollback()
        try:
            db.execute(text("DELETE FROM ops.ingest_batch WHERE file_sha256 = :ck "
                            "AND dataset = :ds AND status = 'received'"),
                       {"ck": hashlib.sha256(raw).hexdigest(), "ds": dataset})
            db.commit()
        except Exception:  # noqa: BLE001
            db.rollback()
        raise


def _ingest_csv_impl(db: Session, *, raw: bytes, file_name: str, dataset: str,
               source_id: int | None, run_id: uuid.UUID | None = None,
               trigger: str = "api") -> dict:
    """Stage a CSV file and evaluate quality rules. Returns a summary dict."""
    settings = get_settings()
    started = time.perf_counter()

    if dataset not in DATASET_TABLES:
        raise ValidationError(
            f"Unsupported dataset '{dataset}'",
            details={"allowed": sorted(DATASET_TABLES)},
        )
    if len(raw) == 0:
        raise ValidationError("The uploaded file is empty")
    if len(raw) > settings.max_upload_bytes:
        raise ValidationError(
            f"File exceeds the {settings.max_upload_mb} MB limit",
            details={"size_bytes": len(raw), "limit_bytes": settings.max_upload_bytes},
        )

    checksum = hashlib.sha256(raw).hexdigest()
    duplicate = find_duplicate_batch(db, checksum, dataset)
    if duplicate and duplicate["status"] in ("validated", "loaded"):
        return {
            "batch_id": duplicate["batch_id"],
            "dataset": dataset,
            "file_name": duplicate["file_name"],
            "idempotent_replay": True,
            "rows_read": duplicate["row_count"],
            "rows_staged": duplicate["accepted_count"],
            "rows_invalid": duplicate["rejected_count"],
            "status": duplicate["status"],
            "message": "Identical file already ingested; returning the original batch.",
        }

    encoding = detect_encoding(raw)
    decoded = raw.decode(encoding)
    delimiter = detect_delimiter(decoded[:8192])
    reader = csv.DictReader(io.StringIO(decoded), delimiter=delimiter)
    if not reader.fieldnames:
        raise ValidationError("The file has no header row")

    canonical = [_normalise_header(h) for h in reader.fieldnames]
    expected = set(DATASET_COLUMNS[dataset])
    missing = sorted(expected - set(canonical))
    if missing:
        raise ValidationError(
            "The file is missing required columns for this dataset",
            details={"dataset": dataset, "missing_columns": missing, "found_columns": canonical},
        )

    batch_id = create_batch(
        db, source_id=source_id, dataset=dataset, file_name=file_name,
        checksum=checksum, size_bytes=len(raw), run_id=run_id,
    )
    db.commit()

    rules = _rules_for_dataset(db, dataset)
    stats = IngestStats()
    seen_keys: set = set()
    staging_table = DATASET_TABLES[dataset]
    col_types = _staging_types(db, staging_table)  # DEMOFIX_COERCE
    insert_cols = DATASET_COLUMNS[dataset] + ["batch_id", "row_number", "raw_payload", "validation_status"]

    buffer: list[dict] = []
    for row_number, raw_row in enumerate(reader, start=1):
        if row_number > settings.max_upload_rows:
            raise ValidationError(
                f"File exceeds the {settings.max_upload_rows} row limit",
                details={"batch_id": str(batch_id), "limit_rows": settings.max_upload_rows},
            )
        stats.rows_read += 1

        normalised = {_normalise_header(k): (v.strip() if isinstance(v, str) else v)
                      for k, v in raw_row.items() if k is not None}
        normalised["__seen_keys__"] = seen_keys

        row_rejects = []
        for rule in rules:
            outcome = rule.evaluate(normalised)
            if outcome.failed:
                row_rejects.append({"rule_code": rule.code, "reason": outcome.reason,
                                    "severity": rule.severity})
        normalised.pop("__seen_keys__", None)

        payload = {c: _coerce(normalised.get(c), col_types.get(c)) for c in DATASET_COLUMNS[dataset]}
        payload["batch_id"] = str(batch_id)
        payload["row_number"] = row_number
        payload["raw_payload"] = json.dumps({k: v for k, v in normalised.items()}, default=str)
        payload["validation_status"] = "invalid" if row_rejects else "valid"
        buffer.append(payload)

        if row_rejects:
            stats.rows_invalid += 1
            for rej in row_rejects:
                stats.rule_stats[rej["rule_code"]] = stats.rule_stats.get(rej["rule_code"], 0) + 1
                stats.rejects.append({
                    "batch_id": str(batch_id), "dataset": dataset, "row_number": row_number,
                    "rule_code": rej["rule_code"], "severity": rej["severity"],
                    "reason": rej["reason"], "raw_payload": payload["raw_payload"],
                })
        else:
            stats.rows_staged += 1

        if len(buffer) >= 1000:
            _flush(db, staging_table, insert_cols, buffer)
            buffer.clear()

    if buffer:
        _flush(db, staging_table, insert_cols, buffer)

    if stats.rejects:
        db.execute(text("""
            INSERT INTO ops.etl_rejects
                (batch_id, dataset, row_number, reason_code, reason_detail, raw_payload)
            VALUES (:batch_id, :dataset, :row_number, :reason_code, :reason_detail,
                    cast(:raw_payload AS jsonb))
        """), [{"batch_id": r["batch_id"], "dataset": r["dataset"],
                "row_number": r["row_number"], "reason_code": r["rule_code"],
                "reason_detail": r["reason"], "raw_payload": r["raw_payload"]}
               for r in stats.rejects])

    status = "validated"
    db.execute(text("""
        UPDATE ops.ingest_batch
        SET status = :status, row_count = :rc, accepted_count = :vc, rejected_count = :ic,
            completed_at = now()
        WHERE batch_id = :bid
    """), {"status": status, "rc": stats.rows_read, "vc": stats.rows_staged,
           "ic": stats.rows_invalid, "bid": batch_id})

    _persist_rule_results(db, batch_id, dataset, rules, stats)
    db.commit()

    duration_ms = round((time.perf_counter() - started) * 1000, 2)
    log.info("ingested %s rows=%s invalid=%s", dataset, stats.rows_read, stats.rows_invalid,
             extra={"batch_id": str(batch_id), "duration_ms": duration_ms})

    return {
        "batch_id": str(batch_id),
        "dataset": dataset,
        "file_name": file_name,
        "encoding": encoding,
        "delimiter": delimiter,
        "checksum": checksum,
        "rows_read": stats.rows_read,
        "rows_staged": stats.rows_staged,
        "rows_invalid": stats.rows_invalid,
        "status": status,
        "duration_ms": duration_ms,
        "idempotent_replay": False,
    }


def _staging_types(db: Session, table: str) -> dict:
    schema, name = table.split(".", 1)
    rows = db.execute(text("""
        SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = :s AND table_name = :t
    """), {"s": schema, "t": name}).all()
    return {r[0]: r[1] for r in rows}


def _coerce(value, data_type):
    """A typed staging column cannot hold unparseable text. The value becomes NULL;
    the original is preserved in raw_payload and the reject reason."""
    if value is None or not data_type or data_type in ("text", "character varying", "character", "jsonb"):
        return value
    s = str(value).strip()
    if s == "":
        return None
    try:
        if data_type in ("integer", "bigint", "smallint"):
            int(s)
        elif data_type in ("numeric", "double precision", "real"):
            if not Decimal(s).is_finite():
                return None
        elif data_type.startswith("timestamp") or data_type == "date":
            if _to_timestamp(s) is None:
                return None
    except (ValueError, ArithmeticError):
        return None
    return value


def _flush(db: Session, table: str, columns: list[str], rows: list[dict]) -> None:
    cols = ", ".join(columns)
    placeholders = ", ".join(f":{c}" for c in columns)
    sql = f"INSERT INTO {table} ({cols}) VALUES ({placeholders})"
    db.execute(text(sql), rows)


def _rules_for_dataset(db: Session, dataset: str) -> list[Rule]:
    rows = db.execute(text("""
        SELECT rule_id, rule_code, expression, severity FROM ops.data_quality_rules
        WHERE dataset = :ds AND is_active ORDER BY rule_id
    """), {"ds": dataset}).mappings().all()
    rules = build_rules([dict(r) for r in rows], load_reference_ids(db))
    for rule, row in zip(rules, rows):
        rule.severity = row["severity"]
        rule.rule_id = row["rule_id"]
    return rules


def _persist_rule_results(db: Session, batch_id, dataset: str, rules: list[Rule], stats: IngestStats) -> None:
    threshold = 0.98
    try:
        raw = db.execute(text("SELECT value FROM app.app_setting WHERE key = 'dq_pass_threshold'")).scalar()
        if raw:
            threshold = float(raw)
    except Exception:  # noqa: BLE001
        db.rollback()

    checked = stats.rows_read or 1
    for rule in rules:
        failed = stats.rule_stats.get(rule.code, 0)
        passed_count = max(checked - failed, 0)
        failure_rate = min(round(failed / checked, 6), 1.0)
        pass_rate = round(passed_count / checked, 4)
        status = "passed" if pass_rate >= threshold else ("warning" if failed < checked else "failed")
        if failed > 0 and status == "passed":
            status = "warning"
        db.execute(text("""
            INSERT INTO ops.data_quality_results
                (rule_id, dataset, severity, passed_count, failed_count, failure_rate, status)
            VALUES (:rid, :ds, :sev, :pc, :fc, :fr, :st)
        """), {"rid": getattr(rule, "rule_id", None), "ds": dataset,
               "sev": getattr(rule, "severity", "medium"), "pc": passed_count,
               "fc": failed, "fr": failure_rate, "st": status})
