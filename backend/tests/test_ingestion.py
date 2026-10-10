"""Unit tests for ingestion helpers (no database required)."""
from app.services import ingestion


def test_header_normalisation_handles_aliases_and_case():
    assert ingestion._normalise_header("Order_ID") == "order_id"
    assert ingestion._normalise_header("order_purchase_timestamp") == "order_purchase_ts"
    assert ingestion._normalise_header("Payment Method") == "payment_type"
    assert ingestion._normalise_header("\ufeffprice") == "price"
    assert ingestion._normalise_header("uf") == "customer_state"


def test_encoding_detection():
    assert ingestion.detect_encoding("café".encode("utf-8")) == "utf-8"
    assert ingestion.detect_encoding("café".encode("latin-1")) in ("utf-8", "latin-1")


def test_delimiter_detection():
    assert ingestion.detect_delimiter("a,b,c\n1,2,3\n") == ","
    assert ingestion.detect_delimiter("a;b;c\n1;2;3\n") == ";"


def test_dataset_contracts_are_complete():
    assert set(ingestion.DATASET_TABLES) == set(ingestion.DATASET_COLUMNS)
    assert ingestion.DATASET_COLUMNS["order_items"][:3] == ["order_id", "order_item_id", "customer_id"]
    assert ingestion.DATASET_TABLES["payments"] == "staging.stg_payments"
