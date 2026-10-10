"""The fixture must be deterministic and must actually inject defects."""
import csv
import importlib.util
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SEED_PATH = REPO / "scripts" / "seed_demo.py"

spec = importlib.util.spec_from_file_location("seed_demo", SEED_PATH)
seed_demo = importlib.util.module_from_spec(spec)
sys.modules["seed_demo"] = seed_demo
spec.loader.exec_module(seed_demo)


def test_generator_is_deterministic(tmp_path):
    a = seed_demo.generate(tmp_path / "a", orders=40)
    b = seed_demo.generate(tmp_path / "b", orders=40)
    assert a["order_items"] == b["order_items"]
    assert a["files"]["order_items.csv"]["sha256_16"] == b["files"]["order_items.csv"]["sha256_16"]


def test_generator_injects_real_defects(tmp_path):
    manifest = seed_demo.generate(tmp_path, orders=120)
    assert manifest["injected_defect_rows"] > 0
    assert manifest["synthetic"] is True

    rows = list(csv.DictReader((tmp_path / "order_items.csv").open(encoding="utf-8")))
    assert any(r["order_id"] == "" for r in rows), "expected a null order_id defect"
    assert any(r["price"] == "N/A" for r in rows), "expected a non-numeric price defect"
    assert any(r["order_status"] == "lost_in_transit" for r in rows), "expected an unknown status defect"


def test_manifest_is_written(tmp_path):
    seed_demo.generate(tmp_path, orders=30)
    manifest = json.loads((tmp_path / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["seed"] == seed_demo.SEED
    assert set(manifest["files"]) == {
        "order_items.csv", "customers.csv", "products.csv", "sellers.csv", "payments.csv"
    }
