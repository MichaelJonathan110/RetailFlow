"""Dashboard overview: KPI tiles + recent activity, all from real tables."""
from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db

router = APIRouter(tags=["overview"])

KPIS = """
SELECT
  (SELECT count(*) FROM warehouse.fact_order_items)                       AS order_items,
  (SELECT count(DISTINCT order_id) FROM warehouse.fact_order_items)        AS orders,
  (SELECT coalesce(sum(total_item_value), 0) FROM warehouse.fact_order_items) AS total_revenue,
  (SELECT count(*) FROM warehouse.dim_product)                             AS products,
  (SELECT count(*) FROM warehouse.dim_customer WHERE is_current)           AS customers,
  (SELECT count(*) FROM warehouse.dim_seller)                              AS sellers,
  (SELECT count(*) FROM ops.etl_run_log)                                       AS etl_runs,
  (SELECT count(*) FROM ops.etl_run_log WHERE status = 'failed')               AS failed_runs,
  (SELECT count(*) FROM ops.etl_rejects)                               AS rejected_records,
  (SELECT count(*) FROM ops.data_quality_rules WHERE is_active)            AS active_rules
"""


@router.get("/overview")
def overview(db: Session = Depends(get_db)):
    kpi = dict(db.execute(text(KPIS)).mappings().one())

    recent_runs = [dict(r) for r in db.execute(text("""
        SELECT r.run_id::text, r.status, r.started_at, r.finished_at,
               r.rows_read, r.rows_inserted AS rows_loaded, r.rows_rejected,
               p.name AS pipeline_name
        FROM ops.etl_run_log r JOIN app.etl_pipeline p USING (pipeline_id)
        ORDER BY r.started_at DESC NULLS LAST LIMIT 5
    """)).mappings()]

    latest_dq = [dict(r) for r in db.execute(text("""
        SELECT q.rule_code, r.dataset, r.severity, r.status,
               1 - r.failure_rate AS pass_rate, r.last_executed_at AS checked_at
        FROM ops.data_quality_results r
        JOIN ops.data_quality_rules q USING (rule_id)
        WHERE (r.rule_id, r.last_executed_at) IN (
            SELECT rule_id, max(last_executed_at) FROM ops.data_quality_results GROUP BY rule_id)
        ORDER BY r.status DESC, r.severity LIMIT 8
    """)).mappings()]

    revenue_trend = [dict(r) for r in db.execute(text("""
        SELECT year_month, total_revenue, orders FROM analytics.v_revenue_by_month
        ORDER BY year_month DESC LIMIT 12
    """)).mappings()]

    return {
        "kpis": kpi,
        "recent_runs": recent_runs,
        "latest_quality": latest_dq,
        "revenue_trend": list(reversed(revenue_trend)),
    }
