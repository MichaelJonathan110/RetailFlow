"""Staging -> warehouse transformations.

Dimension loads are idempotent upserts. The customer dimension is versioned
(SCD Type 2): a change in city/state closes the current row and opens a new one.
Fact loads insert only rows whose business key is not already present, so a
pipeline can be re-run without duplicating facts.
"""
import logging
from decimal import Decimal, InvalidOperation

from sqlalchemy import text
from sqlalchemy.orm import Session

log = logging.getLogger("retailflow.transform")


def _dec(value, default=Decimal("0")) -> Decimal:
    try:
        return Decimal(str(value).strip())
    except (InvalidOperation, ValueError, TypeError, AttributeError):
        return default


def load_dimensions(db: Session, batch_id: str | None = None) -> dict:
    """Load/refresh dim_product, dim_seller, dim_geography and dim_customer (SCD2)."""
    stats = {}

    # ---------------------------------------------------------- dim_product
    res = db.execute(text("""
        INSERT INTO warehouse.dim_product (product_id, product_category, product_name)
        SELECT DISTINCT ON (product_id) product_id, product_category, product_name
        FROM staging.stg_products
        WHERE product_id IS NOT NULL AND validation_status = 'valid'
        ORDER BY product_id, created_at DESC, stg_id DESC
        ON CONFLICT (product_id) DO UPDATE
          SET product_category = coalesce(EXCLUDED.product_category, warehouse.dim_product.product_category),
              product_name = coalesce(EXCLUDED.product_name, warehouse.dim_product.product_name),
              updated_at = now()
    """))
    stats["dim_product"] = res.rowcount if res.rowcount and res.rowcount > 0 else 0

    # ----------------------------------------------------------- dim_seller
    res = db.execute(text("""
        INSERT INTO warehouse.dim_seller (seller_id, seller_city, seller_state)
        SELECT DISTINCT seller_id, seller_city, seller_state
        FROM staging.stg_sellers
        WHERE seller_id IS NOT NULL AND validation_status = 'valid'
        ON CONFLICT (seller_id) DO NOTHING
    """))
    stats["dim_seller"] = res.rowcount if res.rowcount and res.rowcount > 0 else 0

    # -------------------------------------------------------- dim_geography
    res = db.execute(text("""
        WITH region_map (state, region) AS (VALUES
          ('AC','North'),('AP','North'),('AM','North'),('PA','North'),('RO','North'),('RR','North'),('TO','North'),
          ('AL','Northeast'),('BA','Northeast'),('CE','Northeast'),('MA','Northeast'),('PB','Northeast'),
          ('PE','Northeast'),('PI','Northeast'),('RN','Northeast'),('SE','Northeast'),
          ('DF','Central-West'),('GO','Central-West'),('MT','Central-West'),('MS','Central-West'),
          ('ES','Southeast'),('MG','Southeast'),('RJ','Southeast'),('SP','Southeast'),
          ('PR','South'),('RS','South'),('SC','South')
        )
        INSERT INTO warehouse.dim_geography (city, state, region)
        SELECT DISTINCT nullif(trim(customer_city), ''), upper(trim(customer_state)), rm.region
        FROM staging.stg_order_items s JOIN region_map rm ON rm.state = upper(trim(s.customer_state))
        WHERE nullif(trim(s.customer_city), '') IS NOT NULL
        ON CONFLICT (city, state) DO NOTHING
    """))
    stats["dim_geography"] = res.rowcount if res.rowcount and res.rowcount > 0 else 0

    # ------------------------------------------- dim_customer (SCD Type 2)
    # 1. Insert customers we have never seen.
    res = db.execute(text("""
        WITH incoming AS (
            SELECT DISTINCT ON (customer_id) customer_id, customer_unique_id,
                   nullif(trim(customer_city), '') AS customer_city,
                   upper(trim(customer_state)) AS customer_state
            FROM staging.stg_customers
            WHERE customer_id IS NOT NULL AND validation_status = 'valid'
            ORDER BY customer_id, created_at DESC, stg_id DESC  -- DEMOFIX_SCD2 latest staging row wins
        )
        INSERT INTO warehouse.dim_customer (customer_id, customer_unique_id, customer_city, customer_state)
        SELECT i.customer_id, i.customer_unique_id, i.customer_city, i.customer_state
        FROM incoming i
        WHERE NOT EXISTS (SELECT 1 FROM warehouse.dim_customer d WHERE d.customer_id = i.customer_id)
    """))
    inserted = res.rowcount if res.rowcount and res.rowcount > 0 else 0

    # 2. Close versions whose tracked attributes changed.
    res = db.execute(text("""
        WITH incoming AS (
            SELECT DISTINCT ON (customer_id) customer_id,
                   nullif(trim(customer_city), '') AS customer_city,
                   upper(trim(customer_state)) AS customer_state
            FROM staging.stg_customers
            WHERE customer_id IS NOT NULL AND validation_status = 'valid'
            ORDER BY customer_id, created_at DESC, stg_id DESC  -- DEMOFIX_SCD2 latest staging row wins
        )
        UPDATE warehouse.dim_customer d
        SET valid_to = now(), is_current = false
        FROM incoming i
        WHERE d.customer_id = i.customer_id AND d.is_current
          AND (coalesce(d.customer_city, '') IS DISTINCT FROM coalesce(i.customer_city, '')
            OR coalesce(d.customer_state, '') IS DISTINCT FROM coalesce(i.customer_state, ''))
    """))
    changed = res.rowcount if res.rowcount and res.rowcount > 0 else 0

    # 3. Open the new current version for those customers.
    if changed:
        db.execute(text("""
            WITH incoming AS (
                SELECT DISTINCT ON (customer_id) customer_id,
                       nullif(trim(customer_city), '') AS customer_city,
                       upper(trim(customer_state)) AS customer_state
                FROM staging.stg_customers
                WHERE customer_id IS NOT NULL AND validation_status = 'valid'
                ORDER BY customer_id, created_at DESC, stg_id DESC  -- DEMOFIX_SCD2 latest staging row wins
            ),
            latest AS (
                SELECT customer_id, max(version) AS version FROM warehouse.dim_customer GROUP BY customer_id
            )
            INSERT INTO warehouse.dim_customer
                (customer_id, customer_unique_id, customer_city, customer_state, version)
            SELECT i.customer_id,
                   (SELECT customer_unique_id FROM warehouse.dim_customer x
                     WHERE x.customer_id = i.customer_id ORDER BY version DESC LIMIT 1),
                   i.customer_city, i.customer_state, l.version + 1
            FROM incoming i JOIN latest l ON l.customer_id = i.customer_id
            WHERE NOT EXISTS (
                SELECT 1 FROM warehouse.dim_customer c
                WHERE c.customer_id = i.customer_id AND c.is_current)
        """))

    stats["dim_customer_inserted"] = inserted
    stats["dim_customer_versioned"] = changed
    db.commit()
    log.info("dimension load complete", extra={"batch_id": batch_id})
    return stats


def load_facts(db: Session, batch_id: str | None = None) -> dict:
    """Load fact_order_items and fact_payments from validated staging rows."""
    stats = {}

    res = db.execute(text("""
        INSERT INTO warehouse.fact_order_items (
            order_id, order_item_id, date_key, customer_sk, product_sk, seller_sk,
            geography_sk, order_status, purchase_ts, quantity, price, freight_value,
            total_item_value, batch_id
        )
        SELECT
            s.order_id,
            s.order_item_id::int,
            to_char(s.order_purchase_ts::timestamptz, 'YYYYMMDD')::int,
            c.customer_sk, p.product_sk, se.seller_sk, g.geography_sk,
            lower(s.order_status),
            s.order_purchase_ts::timestamptz,
            1,
            s.price::numeric(12,2),
            coalesce(nullif(s.freight_value, '')::numeric(12,2), 0),
            s.price::numeric(12,2) + coalesce(nullif(s.freight_value, '')::numeric(12,2), 0),
            s.batch_id
        FROM staging.stg_order_items s
        JOIN warehouse.dim_product p  ON p.product_id  = s.product_id
        JOIN warehouse.dim_seller  se ON se.seller_id  = s.seller_id
        JOIN warehouse.dim_customer c ON c.customer_id = s.customer_id AND c.is_current
        LEFT JOIN warehouse.dim_geography g
               ON g.city = nullif(trim(s.customer_city), '') AND g.state = upper(trim(s.customer_state))
        WHERE s.validation_status = 'valid'
          AND s.order_id IS NOT NULL
          AND s.order_item_id IS NOT NULL
          AND s.price IS NOT NULL
          AND s.order_purchase_ts IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM warehouse.fact_order_items f
              WHERE f.order_id = s.order_id AND f.order_item_id = s.order_item_id::int)
    """))
    stats["fact_order_items"] = res.rowcount if res.rowcount and res.rowcount > 0 else 0

    res = db.execute(text("""
        INSERT INTO warehouse.fact_payments (order_id, payment_sequential, date_key, payment_type, payment_value, batch_id)
        SELECT p.order_id, p.payment_sequential::int,
               (SELECT min(f.date_key) FROM warehouse.fact_order_items f WHERE f.order_id = p.order_id),
               lower(coalesce(nullif(p.payment_type, ''), 'unknown')),
               p.payment_value::numeric(12,2),
               p.batch_id
        FROM staging.stg_payments p
        WHERE p.validation_status = 'valid'
          AND p.order_id IS NOT NULL AND p.payment_sequential IS NOT NULL
          AND p.payment_value IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM warehouse.fact_payments f
              WHERE f.order_id = p.order_id AND f.payment_sequential = p.payment_sequential::int)
    """))
    stats["fact_payments"] = res.rowcount if res.rowcount and res.rowcount > 0 else 0

    db.commit()
    log.info("fact load complete", extra={"batch_id": batch_id})
    return stats
