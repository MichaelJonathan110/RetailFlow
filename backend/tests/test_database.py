"""Schema-level assertions: the guarantees must live in the database, not in convention."""
from sqlalchemy import text

from app.db import engine
from tests.conftest import needs_db

pytestmark = needs_db


def _scalar(sql, **params):
    with engine.connect() as conn:
        return conn.execute(text(sql), params).scalar()


def test_all_five_schemas_exist():
    n = _scalar("""
        SELECT count(*) FROM information_schema.schemata
        WHERE schema_name IN ('app','ops','staging','warehouse','analytics')
    """)
    assert n == 5


def test_expected_tables_exist():
    expected = {
        ("warehouse", "dim_date"), ("warehouse", "dim_customer"), ("warehouse", "dim_product"),
        ("warehouse", "dim_seller"), ("warehouse", "dim_geography"),
        ("warehouse", "fact_order_items"), ("warehouse", "fact_payments"),
        ("staging", "stg_order_items"), ("staging", "stg_payments"),
        ("ops", "etl_run_log"), ("ops", "etl_stage_log"), ("ops", "ingest_batch"),
        ("ops", "etl_rejects"), ("ops", "data_quality_rules"),
        ("ops", "data_quality_results"), ("ops", "data_reconciliation_results"),
        ("app", "data_source"), ("app", "etl_pipeline"), ("app", "pipeline_stage"),
        ("app", "app_setting"),
    }
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT table_schema, table_name FROM information_schema.tables
            WHERE table_schema IN ('app','ops','staging','warehouse','analytics')
        """)).fetchall()
    assert expected.issubset({(r[0], r[1]) for r in rows})


def test_analytics_views_exist():
    views = {
        "v_order_items", "v_orders", "v_revenue_by_month", "v_revenue_by_category",
        "v_revenue_by_region", "v_top_products", "v_order_status_distribution",
        "v_payment_methods", "v_revenue_reconciliation",
    }
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT table_name FROM information_schema.views WHERE table_schema = 'analytics'
        """)).fetchall()
    assert views.issubset({r[0] for r in rows})


def test_dim_date_covers_the_expected_range():
    assert _scalar("SELECT count(*) FROM warehouse.dim_date") == 1827  # 2016-01-01 .. 2020-12-31
    assert _scalar("SELECT min(full_date)::text FROM warehouse.dim_date") == "2016-01-01"
    assert _scalar("SELECT max(full_date)::text FROM warehouse.dim_date") == "2020-12-31"


def test_customer_dimension_enforces_one_current_row():
    """SCD2 correctness is enforced by a partial unique index, not by convention."""
    idx = _scalar("""
        SELECT count(*) FROM pg_indexes
        WHERE schemaname='warehouse' AND tablename='dim_customer' AND indexname='uq_customer_current'
    """)
    assert idx == 1

    duplicates = _scalar("""
        SELECT count(*) FROM (
            SELECT customer_id FROM warehouse.dim_customer WHERE is_current
            GROUP BY customer_id HAVING count(*) > 1) d
    """)
    assert duplicates == 0


def test_fact_business_keys_are_unique():
    dup_items = _scalar("""
        SELECT count(*) FROM (
            SELECT order_id, order_item_id FROM warehouse.fact_order_items
            GROUP BY 1,2 HAVING count(*) > 1) d
    """)
    assert dup_items == 0


def test_fact_grain_guards_exist():
    """The uniqueness constraints that encode the declared grain must exist."""
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT con.conname FROM pg_constraint con
            JOIN pg_class c ON c.oid = con.conrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname='warehouse' AND c.relname IN ('fact_order_items','fact_payments')
              AND con.contype='u'
        """)).fetchall()
    names = {r[0] for r in rows}
    assert "uq_order_item" in names
    assert "uq_payment" in names


def test_quality_rules_are_seeded_and_parsable():
    with engine.connect() as conn:
        rows = conn.execute(text("SELECT rule_code, expression FROM ops.data_quality_rules")).fetchall()
    assert len(rows) >= 12
    known = {"not_null", "is_integer", "is_numeric", "non_negative", "valid_timestamp",
             "date_in_range", "allowed_values", "ref_exists", "unique_key"}
    for code, expression in rows:
        assert expression.split(":")[0] in known, f"rule {code} uses an unknown check"


def test_no_measure_requires_joining_the_two_facts():
    """Guard against a future view that multiplies payments by line items."""
    with engine.connect() as conn:
        definition = conn.execute(text("""
            SELECT pg_get_viewdef('analytics.v_orders'::regclass, true)
        """)).scalar()
    assert "fact_payments" not in definition
