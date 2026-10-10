"""API contract tests. Database-independent endpoints always run; the rest need PostgreSQL."""
from tests.conftest import needs_db


def test_root_identifies_the_service(client):
    body = client.get("/").json()
    assert body["name"] == "RetailFlow"
    assert body["api"] == "/api/v1"


def test_openapi_is_served(client):
    spec = client.get("/api/v1/openapi.json")
    assert spec.status_code == 200
    assert spec.json()["info"]["title"] == "RetailFlow API"


def test_health_reports_database_state(client):
    body = client.get("/api/v1/health").json()
    assert body["status"] in ("ok", "degraded")
    assert "database" in body
    assert isinstance(body["database"]["connected"], bool)


def test_unknown_route_uses_the_error_envelope(client):
    response = client.get("/api/v1/definitely-not-a-route")
    assert response.status_code == 404
    body = response.json()
    assert "error" in body and "code" in body["error"] and "message" in body["error"]


def test_invalid_dataset_is_rejected_with_details(client):
    response = client.post(
        "/api/v1/ingestion/upload",
        files={"file": ("x.csv", b"a,b\n1,2\n", "text/csv")},
        data={"dataset": "not_a_dataset"},
    )
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "validation_failed"
    assert "allowed" in body["error"]["details"]


@needs_db
def test_overview_returns_kpis(client):
    body = client.get("/api/v1/overview").json()
    for key in ("order_items", "orders", "total_revenue", "etl_runs", "active_rules"):
        assert key in body["kpis"]
    assert isinstance(body["recent_runs"], list)


@needs_db
def test_pipelines_include_an_executable_master(client):
    items = client.get("/api/v1/pipelines").json()["items"]
    master = [p for p in items if p["name"] == "RetailFlow Master Pipeline"]
    assert master and master[0]["is_executable"] is True
    pentaho = [p for p in items if p["engine"] == "pentaho"]
    assert pentaho and pentaho[0]["is_executable"] is False


@needs_db
def test_pentaho_pipeline_refuses_to_run(client):
    items = client.get("/api/v1/pipelines").json()["items"]
    pentaho_id = [p["pipeline_id"] for p in items if p["engine"] == "pentaho"][0]
    response = client.post(f"/api/v1/pipelines/{pentaho_id}/run", json={})
    assert response.status_code == 422
    assert "not executable" in response.json()["error"]["message"]


@needs_db
def test_quality_rules_are_seeded(client):
    items = client.get("/api/v1/quality/rules").json()["items"]
    codes = {r["rule_code"] for r in items}
    assert "OI_DUPLICATE_KEY" in codes
    assert len(items) >= 12


@needs_db
def test_analytics_summary_has_expected_keys(client):
    body = client.get("/api/v1/analytics/summary").json()
    for key in ("total_revenue", "orders", "units", "avg_order_value", "avg_items_per_order"):
        assert key in body


@needs_db
def test_warehouse_catalogue_lists_both_facts(client):
    items = client.get("/api/v1/warehouse/tables").json()["items"]
    names = {f"{t['schema']}.{t['table']}" for t in items}
    assert "warehouse.fact_order_items" in names
    assert "warehouse.fact_payments" in names
    assert "warehouse.dim_customer" in names


@needs_db
def test_settings_hide_environment_controlled_values(client):
    body = client.get("/api/v1/settings").json()
    non_editable = [s for s in body["items"] if not s["is_ui_editable"]]
    assert non_editable, "expected some environment-controlled settings"
    assert all(s["key"] != "database_url" or s["value"] == "" for s in non_editable)


@needs_db
def test_environment_setting_cannot_be_patched(client):
    response = client.patch("/api/v1/settings/database_url", json={"value": "hacked"})
    assert response.status_code == 422
