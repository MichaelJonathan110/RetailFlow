-- RetailFlow: dimensional warehouse.
--
-- GRAIN DECLARATIONS (authoritative):
--   warehouse.fact_order_items : ONE ROW PER ORDER ITEM (order_id + order_item_id).
--   warehouse.fact_payments     : ONE ROW PER PAYMENT TRANSACTION (order_id + payment_sequential).
-- The two facts are NOT joined to each other in any single query that aggregates revenue:
-- doing so would multiply payment amounts by line-item count. They are reconciled separately.

-- ------------------------------------------------------------------ dim_date
CREATE TABLE IF NOT EXISTS warehouse.dim_date (
    date_key    integer PRIMARY KEY,           -- yyyymmdd
    full_date   date NOT NULL UNIQUE,
    year        integer NOT NULL,
    quarter     integer NOT NULL,
    month       integer NOT NULL,
    month_name  text NOT NULL,
    day         integer NOT NULL,
    day_of_week integer NOT NULL,
    day_name    text NOT NULL,
    iso_week    integer NOT NULL,
    is_weekend  boolean NOT NULL
);

-- -------------------------------------------------------------- dim_customer (SCD2)
CREATE TABLE IF NOT EXISTS warehouse.dim_customer (
    customer_sk      bigserial PRIMARY KEY,
    customer_id      text NOT NULL,            -- business key (order-scoped, as in source)
    customer_unique_id text,
    customer_city    text,
    customer_state   text,
    valid_from       timestamptz NOT NULL DEFAULT now(),
    valid_to         timestamptz,
    is_current       boolean NOT NULL DEFAULT true,
    version          integer NOT NULL DEFAULT 1,
    CONSTRAINT uq_customer_version UNIQUE (customer_id, version),
    CONSTRAINT ck_customer_valid_range CHECK (valid_to IS NULL OR valid_to >= valid_from)
);
CREATE INDEX IF NOT EXISTS ix_dim_customer_current ON warehouse.dim_customer (customer_id) WHERE is_current;
COMMENT ON TABLE warehouse.dim_customer IS 'SCD Type 2. valid_from/valid_to/is_current/version track attribute history. Only one is_current row per customer_id (enforced by partial unique index).';
CREATE UNIQUE INDEX IF NOT EXISTS uq_customer_current ON warehouse.dim_customer (customer_id) WHERE is_current;

-- --------------------------------------------------------------- dim_product
CREATE TABLE IF NOT EXISTS warehouse.dim_product (
    product_sk       bigserial PRIMARY KEY,
    product_id       text NOT NULL UNIQUE,
    product_category text,
    product_name     text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- --------------------------------------------------------------- dim_seller
CREATE TABLE IF NOT EXISTS warehouse.dim_seller (
    seller_sk    bigserial PRIMARY KEY,
    seller_id    text NOT NULL UNIQUE,
    seller_city  text,
    seller_state text,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------ dim_geography
CREATE TABLE IF NOT EXISTS warehouse.dim_geography (
    geography_sk bigserial PRIMARY KEY,
    city         text,
    state        text,
    region       text NOT NULL,
    CONSTRAINT uq_geo UNIQUE (city, state)
);
COMMENT ON COLUMN warehouse.dim_geography.region IS 'Derived from the Brazilian state (UF) grouping. Documented in docs/data-dictionary.md.';

-- ------------------------------------------------------- fact_order_items
CREATE TABLE IF NOT EXISTS warehouse.fact_order_items (
    order_item_sk     bigserial PRIMARY KEY,
    order_id          text NOT NULL,
    order_item_id     integer NOT NULL,
    date_key          integer NOT NULL REFERENCES warehouse.dim_date(date_key),
    customer_sk       bigint NOT NULL REFERENCES warehouse.dim_customer(customer_sk),
    product_sk        bigint NOT NULL REFERENCES warehouse.dim_product(product_sk),
    seller_sk         bigint NOT NULL REFERENCES warehouse.dim_seller(seller_sk),
    geography_sk      bigint REFERENCES warehouse.dim_geography(geography_sk),
    order_status      text NOT NULL,
    purchase_ts       timestamptz NOT NULL,
    quantity          integer NOT NULL DEFAULT 1,
    price             numeric(12,2) NOT NULL,
    freight_value     numeric(12,2) NOT NULL DEFAULT 0,
    total_item_value  numeric(12,2) NOT NULL,
    batch_id          uuid REFERENCES ops.ingest_batch(batch_id) ON DELETE SET NULL,
    loaded_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_order_item UNIQUE (order_id, order_item_id),
    CONSTRAINT ck_price_nonneg CHECK (price >= 0),
    CONSTRAINT ck_freight_nonneg CHECK (freight_value >= 0)
);
CREATE INDEX IF NOT EXISTS ix_foi_date ON warehouse.fact_order_items (date_key);
CREATE INDEX IF NOT EXISTS ix_foi_product ON warehouse.fact_order_items (product_sk);
CREATE INDEX IF NOT EXISTS ix_foi_seller ON warehouse.fact_order_items (seller_sk);
CREATE INDEX IF NOT EXISTS ix_foi_customer ON warehouse.fact_order_items (customer_sk);
CREATE INDEX IF NOT EXISTS ix_foi_geo ON warehouse.fact_order_items (geography_sk);
CREATE INDEX IF NOT EXISTS ix_foi_status ON warehouse.fact_order_items (order_status);
COMMENT ON TABLE warehouse.fact_order_items IS 'Grain: one row per order item. Measures: price, freight_value, total_item_value (= price + freight_value), quantity. Revenue is SUM(price) or SUM(total_item_value) as documented; never SUM over a join to fact_payments.';

-- --------------------------------------------------------- fact_payments
CREATE TABLE IF NOT EXISTS warehouse.fact_payments (
    payment_sk         bigserial PRIMARY KEY,
    order_id           text NOT NULL,
    payment_sequential integer NOT NULL,
    date_key           integer REFERENCES warehouse.dim_date(date_key),
    payment_type       text NOT NULL,
    payment_value      numeric(12,2) NOT NULL,
    batch_id           uuid REFERENCES ops.ingest_batch(batch_id) ON DELETE SET NULL,
    loaded_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_payment UNIQUE (order_id, payment_sequential)
);
CREATE INDEX IF NOT EXISTS ix_fp_order ON warehouse.fact_payments (order_id);
COMMENT ON TABLE warehouse.fact_payments IS 'Grain: one row per payment transaction. Used for payment-method analysis and revenue reconciliation against fact_order_items.';
