"""Business analytics over the analytics.v_* views. Read-only."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db

router = APIRouter(tags=["analytics"])


def _rows(db: Session, sql: str, params: dict | None = None) -> list[dict]:
    return [dict(r) for r in db.execute(text(sql), params or {}).mappings()]


@router.get("/analytics/summary")
def summary(db: Session = Depends(get_db)):
    return dict(db.execute(text("""
        SELECT
          (SELECT coalesce(sum(total_revenue), 0) FROM analytics.v_orders)      AS total_revenue,
          (SELECT count(*) FROM analytics.v_orders)                              AS orders,
          (SELECT coalesce(sum(units), 0) FROM analytics.v_orders)               AS units,
          (SELECT coalesce(round(avg(total_revenue), 2), 0) FROM analytics.v_orders) AS avg_order_value,
          (SELECT coalesce(round(avg(item_count), 2), 0) FROM analytics.v_orders) AS avg_items_per_order
    """)).mappings().one())


@router.get("/analytics/revenue-by-month")
def revenue_by_month(db: Session = Depends(get_db)):
    return {"items": _rows(db, "SELECT * FROM analytics.v_revenue_by_month ORDER BY year_month")}


@router.get("/analytics/revenue-by-category")
def revenue_by_category(limit: int = Query(20, ge=1, le=100), db: Session = Depends(get_db)):
    return {"items": _rows(db, """
        SELECT product_category, item_revenue, total_revenue, units, orders
        FROM analytics.v_revenue_by_category ORDER BY total_revenue DESC LIMIT :lim
    """, {"lim": limit})}


@router.get("/analytics/revenue-by-region")
def revenue_by_region(db: Session = Depends(get_db)):
    return {"items": _rows(db, "SELECT * FROM analytics.v_revenue_by_region ORDER BY total_revenue DESC")}


@router.get("/analytics/top-products")
def top_products(limit: int = Query(10, ge=1, le=100), db: Session = Depends(get_db)):
    return {"items": _rows(db, """
        SELECT product_id, product_category, product_name, total_revenue, units, orders
        FROM analytics.v_top_products ORDER BY total_revenue DESC LIMIT :lim
    """, {"lim": limit})}


@router.get("/analytics/top-sellers")
def top_sellers(limit: int = Query(10, ge=1, le=100), db: Session = Depends(get_db)):
    return {"items": _rows(db, """
        SELECT s.seller_id, s.seller_state, count(DISTINCT v.order_id) AS orders,
               sum(v.quantity) AS units, sum(v.total_item_value) AS total_revenue
        FROM analytics.v_order_items v JOIN warehouse.dim_seller s ON s.seller_id = v.seller_id
        GROUP BY s.seller_id, s.seller_state ORDER BY total_revenue DESC LIMIT :lim
    """, {"lim": limit})}


@router.get("/analytics/order-status")
def order_status(db: Session = Depends(get_db)):
    return {"items": _rows(db, "SELECT * FROM analytics.v_order_status_distribution ORDER BY orders DESC")}


@router.get("/analytics/payment-methods")
def payment_methods(db: Session = Depends(get_db)):
    return {"items": _rows(db, "SELECT * FROM analytics.v_payment_methods ORDER BY payment_value DESC")}


@router.get("/analytics/customers")
def customer_analytics(limit: int = Query(20, ge=1, le=100), db: Session = Depends(get_db)):
    return {"items": _rows(db, """
        SELECT c.customer_unique_id, count(DISTINCT v.order_id) AS orders,
               sum(v.total_item_value) AS total_revenue, min(v.full_date) AS first_order,
               max(v.full_date) AS last_order
        FROM analytics.v_order_items v
        JOIN warehouse.dim_customer c ON c.customer_id = v.customer_id AND c.is_current
        WHERE c.customer_unique_id IS NOT NULL
        GROUP BY c.customer_unique_id ORDER BY total_revenue DESC LIMIT :lim
    """, {"lim": limit})}
