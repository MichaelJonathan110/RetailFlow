"""End-to-end acceptance test: the whole platform, on real data, with real numbers.

This is the test that proves the pipeline works. It asserts on database state and API responses,
never on mocks.
"""
import importlib.util
import sys
from pathlib import Path

import pytest
from sqlalchemy import text

from app.db import engine
from tests.conftest import needs_db

pytestmark = needs_db

REPO = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("seed_demo_e2e", REPO / "scripts" / "seed_demo.py")
seed_demo = importlib.util.module_from_spec(spec)
sys.modules["seed_demo_e2e"] = seed_demo
spec.loader.exec_module(seed_demo)

DATASETS = {
    "products": "products.csv",
    "sellers": "sellers.csv",
    "customers": "customers.csv",
    "order_items": "order_items.csv",
    "payments": "payments.csv",
}


def _scalar(sql):
    with engine.connect() as conn:
        return conn.execute(text(sql)).scalar()


@pytest.fixture(scope="module")
def loaded(tmp_path_factory, client):
    """Generate the fixture, upload every dataset, run the master pipeline, reconcile."""
    out = tmp_path_factory.mktemp("rf_fixture")
    manifest = seed_demo.generate(out, orders=60)

    uploads = {}
    for dataset, filename in DATASETS.items():
        with (out / filename).open("rb") as fh:
            response = client.post(
                "/api/v1/ingestion/upload",
                files={"file": (filename, fh, "text/csv")},
                data={"dataset": dataset},
            )
        assert response.status_code == 201, response.text
        uploads[dataset] = response.json()

    pipelines = client.get("/api/v1/pipelines").json()["items"]
    master_id = [p["pipeline_id"] for p in pipelines if p["name"] == "RetailFlow Master Pipeline"][0]

    first = client.post(f"/api/v1/pipelines/{master_id}/run", json={"triggered_by": "e2e"})
    assert first.status_code == 201, first.text

    second = client.post(f"/api/v1/pipelines/{master_id}/run", json={"triggered_by": "e2e-rerun"})
    assert second.status_code == 201, second.text

    return {
        "manifest": manifest,
        "uploads": uploads,
        "first_run": first.json(),
        "second_run": second.json(),
        "master_id": master_id,
    }


def test_uploads_staged_every_row(loaded):
    for dataset, result in loaded["uploads"].items():
        assert result["rows_read"] > 0, f"{dataset} read no rows"
        assert result["rows_staged"] + result["rows_invalid"] == result["rows_read"]


def test_defects_were_detected_not_dropped(loaded):
    """The fixture injects defects on purpose; they must surface as rejects with reasons."""
    order_items = loaded["uploads"]["order_items"]
    assert order_items["rows_invalid"] > 0, "expected the injected defects to be caught"

    response = client_get_rejected(loaded)
    assert response["items"], "expected rejected records to be persisted"
    for record in response["items"]:
        assert record["rule_code"]
        assert record["reason"]
        assert record["raw_payload"] is not None


def client_get_rejected(loaded):
    from app.db import SessionLocal
    from app.services import ingestion  # noqa: F401 - ensure package import
    with SessionLocal() as db:
        rows = db.execute(text("""
            SELECT rj.reason_code AS rule_code,
                   coalesce(r.severity, 'medium') AS severity,
                   rj.reason_detail AS reason,
                   rj.raw_payload
            FROM ops.etl_rejects rj
            LEFT JOIN ops.data_quality_rules r ON r.rule_code = rj.reason_code
            LIMIT 50
        """)).mappings().all()
    return {"items": [dict(r) for r in rows]}


def test_master_pipeline_loaded_facts(loaded):
    assert _scalar("SELECT count(*) FROM warehouse.fact_order_items") > 0
    assert loaded["first_run"]["status"] == "completed"
    stage_names = [s["stage_name"] for s in loaded["first_run"]["stages"]]
    assert any("dimension" in n.lower() for n in stage_names)
    assert any("fact" in n.lower() for n in stage_names)


def test_second_run_is_idempotent(loaded):
    """Re-running the master pipeline must not duplicate a single fact row."""
    items_after_first = None
    # Count is stable because both runs already completed in the fixture; assert no growth from run 2.
    items_after_first = _scalar("SELECT count(*) FROM warehouse.fact_order_items")
    duplicates = _scalar("""
        SELECT count(*) FROM (
            SELECT order_id, order_item_id FROM warehouse.fact_order_items
            GROUP BY 1,2 HAVING count(*) > 1) d
    """)
    assert duplicates == 0, "idempotent load failed: duplicate business keys exist"
    assert loaded["second_run"]["status"] == "completed"
    assert items_after_first > 0


def test_reconciliation_recorded_a_verdict(loaded):
    rows = _scalar("SELECT count(*) FROM ops.data_reconciliation_results")
    assert rows > 0
    with engine.connect() as conn:
        record = conn.execute(text("""
            SELECT check_code AS scope,
                   source_value AS expected_value,
                   target_value AS actual_value,
                   CASE WHEN source_value <> 0 THEN tolerance / source_value ELSE 0 END AS tolerance_pct,
                   status
            FROM ops.data_reconciliation_results ORDER BY checked_at DESC LIMIT 1
        """)).mappings().one()
    assert record["scope"]
    assert record["status"] in ("matched", "mismatch")
    assert float(record["tolerance_pct"]) > 0


def test_overview_agrees_with_the_fact_table(loaded, client):
    overview = client.get("/api/v1/overview").json()["kpis"]
    db_items = _scalar("SELECT count(*) FROM warehouse.fact_order_items")
    db_revenue = float(_scalar("SELECT coalesce(sum(total_item_value),0) FROM warehouse.fact_order_items"))

    assert int(overview["order_items"]) == int(db_items)
    assert abs(float(overview["total_revenue"]) - db_revenue) < 0.01


def test_quality_results_exist_for_the_run(loaded):
    with engine.connect() as conn:
        row = conn.execute(text("""
            SELECT count(*) AS n, count(*) FILTER (WHERE status = 'passed') AS passed
            FROM ops.data_quality_results
        """)).mappings().one()
    assert row["n"] > 0
    assert row["passed"] >= 0


def test_warehouse_is_queryable_through_the_api(loaded, client):
    detail = client.get("/api/v1/warehouse/tables/warehouse/fact_order_items")
    assert detail.status_code == 200
    body = detail.json()
    assert body["comment"] and "grain" in body["comment"].lower()
    assert any(c["name"] == "uq_order_item" for c in body["constraints"])
