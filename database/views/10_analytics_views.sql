-- RetailFlow: read-only analytics views consumed by the API and Power BI.
-- These views deliberately do NOT join fact_order_items to fact_payments.

CREATE OR REPLACE VIEW analytics.v_order_items AS
SELECT
    f.order_item_sk,
    f.order_id,
    f.order_item_id,
    f.purchase_ts,
    d.full_date,
    d.year,
    d.month,
    d.year || '-' || lpad(d.month::text, 2, '0') AS year_month,
    d.quarter,
    f.order_status,
    p.product_id,
    p.product_category,
    p.product_name,
    s.seller_id,
    s.seller_state,
    c.customer_id,
    c.customer_unique_id,
    c.customer_state,
    g.city AS customer_city,
    g.region AS customer_region,
    f.quantity,
    f.price,
    f.freight_value,
    f.total_item_value
FROM warehouse.fact_order_items f
JOIN warehouse.dim_date     d ON d.date_key     = f.date_key
JOIN warehouse.dim_product  p ON p.product_sk  = f.product_sk
JOIN warehouse.dim_seller   s ON s.seller_sk   = f.seller_sk
JOIN warehouse.dim_customer c ON c.customer_sk = f.customer_sk
LEFT JOIN warehouse.dim_geography g ON g.geography_sk = f.geography_sk;
COMMENT ON VIEW analytics.v_order_items IS 'Flattened order-item fact for BI consumption. Revenue = SUM(price) (item revenue, excl. freight) or SUM(total_item_value) (incl. freight). Both are exposed.';

-- One row per order: the correct denominator for Average Order Value.
CREATE OR REPLACE VIEW analytics.v_orders AS
SELECT
    order_id,
    min(purchase_ts)  AS purchase_ts,
    min(full_date)    AS full_date,
    min(year)         AS year,
    min(year_month)   AS year_month,
    max(order_status) AS order_status,
    min(customer_id)  AS customer_id,
    count(*)          AS item_count,
    sum(quantity)     AS units,
    sum(price)        AS item_revenue,
    sum(freight_value) AS freight_revenue,
    sum(total_item_value) AS total_revenue
FROM analytics.v_order_items
GROUP BY order_id;
COMMENT ON VIEW analytics.v_orders IS 'Grain: one row per order. Average Order Value MUST use this view (sum(total_revenue)/count(*)), never a line-item average.';

CREATE OR REPLACE VIEW analytics.v_revenue_by_category AS
SELECT product_category, sum(price) AS item_revenue, sum(total_item_value) AS total_revenue,
       sum(quantity) AS units, count(DISTINCT order_id) AS orders
FROM analytics.v_order_items GROUP BY product_category;

CREATE OR REPLACE VIEW analytics.v_revenue_by_region AS
SELECT customer_region, customer_state, sum(total_item_value) AS total_revenue,
       count(DISTINCT order_id) AS orders, sum(quantity) AS units
FROM analytics.v_order_items GROUP BY customer_region, customer_state;

CREATE OR REPLACE VIEW analytics.v_revenue_by_month AS
SELECT year_month, min(full_date) AS period_start, sum(total_item_value) AS total_revenue,
       sum(price) AS item_revenue, count(DISTINCT order_id) AS orders, sum(quantity) AS units
FROM analytics.v_order_items GROUP BY year_month;

CREATE OR REPLACE VIEW analytics.v_top_products AS
SELECT product_id, product_category, product_name,
       sum(total_item_value) AS total_revenue, sum(quantity) AS units,
       count(DISTINCT order_id) AS orders
FROM analytics.v_order_items GROUP BY product_id, product_category, product_name;

CREATE OR REPLACE VIEW analytics.v_order_status_distribution AS
SELECT order_status, count(*) AS orders, sum(total_revenue) AS total_revenue
FROM analytics.v_orders GROUP BY order_status;

CREATE OR REPLACE VIEW analytics.v_payment_methods AS
SELECT payment_type, count(*) AS payments, sum(payment_value) AS payment_value
FROM warehouse.fact_payments GROUP BY payment_type;

-- Reconciliation basis: totals that must agree between the two fact tables.
CREATE OR REPLACE VIEW analytics.v_revenue_reconciliation AS
SELECT
    (SELECT coalesce(sum(price), 0) FROM warehouse.fact_order_items) AS order_items_revenue,
    (SELECT coalesce(sum(payment_value), 0) FROM warehouse.fact_payments) AS payments_revenue,
    (SELECT count(DISTINCT order_id) FROM warehouse.fact_order_items) AS order_item_orders,
    (SELECT count(DISTINCT order_id) FROM warehouse.fact_payments) AS payment_orders;
