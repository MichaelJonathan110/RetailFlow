"""Revenue reconciliation between the two fact tables.

fact_order_items and fact_payments share order_id but have different grains.
We therefore compare *aggregate totals* per order, never row counts, and record a
variance with an explicit tolerance so a pass/fail decision is auditable.
"""
import logging

from sqlalchemy import text
from sqlalchemy.orm import Session

log = logging.getLogger("retailflow.reconciliation")

DEFAULT_TOLERANCE_PCT = 0.005  # 0.5%


def reconcile(db: Session, *, batch_id: str | None = None, run_id=None,
              tolerance_pct: float = DEFAULT_TOLERANCE_PCT) -> list[dict]:
    totals = db.execute(text("SELECT * FROM analytics.v_revenue_reconciliation")).mappings().one()

    checks = [
        {
            "check_code": "revenue_total",
            "source": float(totals["order_items_revenue"] or 0),
            "target": float(totals["payments_revenue"] or 0),
            "note": "Item revenue (sum of price) vs payment revenue (sum of payment_value).",
        },
        {
            "check_code": "order_count",
            "source": float(totals["order_item_orders"] or 0),
            "target": float(totals["payment_orders"] or 0),
            "note": "Distinct orders present in each fact table.",
        },
    ]

    results = []
    for check in checks:
        source, target = check["source"], check["target"]
        difference = round(target - source, 2)
        tolerance = round(abs(source) * tolerance_pct, 2)
        status = "matched" if abs(difference) <= tolerance else "mismatch"
        row = db.execute(text("""
            INSERT INTO ops.data_reconciliation_results
                (run_id, check_code, description, source_value, target_value,
                 difference, tolerance, status, checked_at)
            VALUES (:rid, :code, :desc, :source, :target, :diff, :tol, :status, now())
            RETURNING recon_id, check_code, description, source_value, target_value,
                      difference, tolerance, status, checked_at
        """), {"rid": run_id, "code": check["check_code"], "desc": check["note"],
               "source": source, "target": target, "diff": difference,
               "tol": tolerance, "status": status}).mappings().one()
        results.append(dict(row))

    db.commit()
    log.info("reconciliation complete", extra={"batch_id": batch_id})
    return results
