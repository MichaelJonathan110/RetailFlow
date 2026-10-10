-- RetailFlow: staging layer. Source-aligned, permissive types, raw payload retained.

CREATE TABLE IF NOT EXISTS staging.stg_order_items (
    stg_id             bigserial PRIMARY KEY,
    batch_id           uuid NOT NULL REFERENCES ops.ingest_batch(batch_id) ON DELETE CASCADE,
    row_number         integer NOT NULL,
    order_id           text,
    order_item_id      integer,
    customer_id        text,
    product_id         text,
    seller_id          text,
    order_status       text,
    order_purchase_ts  text,
    price              text,
    freight_value      text,
    payment_value      text,
    customer_city      text,
    customer_state     text,
    raw_payload        jsonb NOT NULL,
    validation_status  text NOT NULL DEFAULT 'pending'
                       CHECK (validation_status IN ('pending','valid','invalid')),
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_stg_oi_batch ON staging.stg_order_items (batch_id);
CREATE INDEX IF NOT EXISTS ix_stg_oi_status ON staging.stg_order_items (validation_status);
COMMENT ON TABLE staging.stg_order_items IS 'Raw order-item rows exactly as received, before type coercion. Columns are text on purpose: coercion failures become reject records instead of load errors.';

CREATE TABLE IF NOT EXISTS staging.stg_customers (
    stg_id        bigserial PRIMARY KEY,
    batch_id      uuid NOT NULL REFERENCES ops.ingest_batch(batch_id) ON DELETE CASCADE,
    row_number    integer NOT NULL,
    customer_id   text,
    customer_unique_id text,
    customer_city text,
    customer_state text,
    raw_payload   jsonb NOT NULL,
    validation_status text NOT NULL DEFAULT 'pending',
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_stg_cust_batch ON staging.stg_customers (batch_id);

CREATE TABLE IF NOT EXISTS staging.stg_products (
    stg_id             bigserial PRIMARY KEY,
    batch_id           uuid NOT NULL REFERENCES ops.ingest_batch(batch_id) ON DELETE CASCADE,
    row_number         integer NOT NULL,
    product_id         text,
    product_category   text,
    product_name       text,
    raw_payload        jsonb NOT NULL,
    validation_status  text NOT NULL DEFAULT 'pending',
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_stg_prod_batch ON staging.stg_products (batch_id);

CREATE TABLE IF NOT EXISTS staging.stg_sellers (
    stg_id         bigserial PRIMARY KEY,
    batch_id       uuid NOT NULL REFERENCES ops.ingest_batch(batch_id) ON DELETE CASCADE,
    row_number     integer NOT NULL,
    seller_id      text,
    seller_city    text,
    seller_state   text,
    raw_payload    jsonb NOT NULL,
    validation_status text NOT NULL DEFAULT 'pending',
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_stg_seller_batch ON staging.stg_sellers (batch_id);

CREATE TABLE IF NOT EXISTS staging.stg_payments (
    stg_id          bigserial PRIMARY KEY,
    batch_id        uuid NOT NULL REFERENCES ops.ingest_batch(batch_id) ON DELETE CASCADE,
    row_number      integer NOT NULL,
    order_id        text,
    payment_sequential integer,
    payment_type    text,
    payment_value   text,
    raw_payload     jsonb NOT NULL,
    validation_status text NOT NULL DEFAULT 'pending',
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_stg_pay_batch ON staging.stg_payments (batch_id);
