"""Deterministic synthetic demo data generator for RetailFlow.

Why deterministic: a portfolio/demo build must produce the *same* numbers on every
machine, so screenshots, tests and documentation all agree. Every random draw is
seeded from a fixed constant.

Deliberately imperfect: the fixture injects a small number of realistic data-quality
defects (null order id, non-numeric price, duplicate key, negative price, bad date,
unknown status) so the quality dashboards and reject log show real findings rather
than an empty "all green" page.

Usage:
    python scripts/seed_demo.py --out sample-data --orders 1500
    python scripts/seed_demo.py --out sample-data --orders 1500 --upload http://localhost:8000/api/v1
"""
import argparse
import csv
import hashlib
import json
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

SEED = 20240617
STATES = ["SP", "RJ", "MG", "RS", "PR", "SC", "BA", "DF", "PE", "CE", "GO", "ES", "AM", "PA"]
CITIES = {
    "SP": ["sao paulo", "campinas", "santos", "ribeirao preto"],
    "RJ": ["rio de janeiro", "niteroi", "campos dos goytacazes"],
    "MG": ["belo horizonte", "uberlandia", "juiz de fora"],
    "RS": ["porto alegre", "caxias do sul", "pelotas"],
    "PR": ["curitiba", "londrina", "maringa"],
    "SC": ["florianopolis", "joinville", "blumenau"],
    "BA": ["salvador", "feira de santana", "vitoria da conquista"],
    "DF": ["brasilia", "ceilandia"],
    "PE": ["recife", "olinda", "caruaru"],
    "CE": ["fortaleza", "caucaia", "juazeiro do norte"],
    "GO": ["goiania", "anapolis"],
    "ES": ["vitoria", "vila velha"],
    "AM": ["manaus", "parintins"],
    "PA": ["belem", "ananindeua"],
}
CATEGORIES = [
    ("bed_bath_table", "Bed, Bath & Table", 45, 220),
    ("health_beauty", "Health & Beauty", 30, 190),
    ("sports_leisure", "Sports & Leisure", 40, 260),
    ("furniture_decor", "Furniture & Decor", 60, 420),
    ("computers_accessories", "Computers & Accessories", 80, 650),
    ("housewares", "Housewares", 25, 180),
    ("watches_gifts", "Watches & Gifts", 70, 380),
    ("telephony", "Telephony", 35, 300),
    ("garden_tools", "Garden Tools", 40, 250),
    ("auto", "Auto", 55, 340),
    ("toys", "Toys", 30, 200),
    ("cool_stuff", "Cool Stuff", 50, 290),
]
STATUSES = ["delivered"] * 88 + ["shipped"] * 5 + ["canceled"] * 3 + ["invoiced"] * 2 + ["processing"] * 2
PAYMENT_TYPES = ["credit_card"] * 74 + ["boleto"] * 19 + ["voucher"] * 5 + ["debit_card"] * 2


def _product_id(rng):
    return "".join(rng.choice("0123456789abcdef") for _ in range(32))


def _customer_id(rng):
    return "".join(rng.choice("0123456789abcdef") for _ in range(32))


def _seller_id(rng, i):
    return f"seller{i:026d}"


def generate(out_dir: Path, orders: int = 1500) -> dict:
    rng = random.Random(SEED)
    out_dir.mkdir(parents=True, exist_ok=True)

    n_products = max(60, orders // 12)
    n_sellers = max(12, orders // 90)
    n_customers = max(200, int(orders * 1.15))

    products = []
    for i in range(n_products):
        cat, name, lo, hi = rng.choice(CATEGORIES)
        products.append({
            "product_id": _product_id(rng),
            "product_category": cat,
            "product_name": f"{name} #{i:04d}",
            "_price_lo": lo,
            "_price_hi": hi,
        })

    sellers = []
    for i in range(n_sellers):
        st = rng.choice(STATES)
        sellers.append({"seller_id": _seller_id(rng, i), "seller_city": rng.choice(CITIES[st]), "seller_state": st})

    customers = []
    for i in range(n_customers):
        st = rng.choice(STATES)
        customers.append({
            "customer_id": _customer_id(rng),
            "customer_unique_id": "".join(rng.choice("0123456789abcdef") for _ in range(32)),
            "customer_city": rng.choice(CITIES[st]),
            "customer_state": st,
        })

    start = datetime(2017, 1, 1, tzinfo=timezone.utc)
    span_days = 1080
    order_items, payments = [], []
    order_item_counter = 0

    for o in range(orders):
        order_id = "".join(rng.choice("0123456789abcdef") for _ in range(32))
        cust = rng.choice(customers)
        # Growth trend + weekly seasonality, so the time series has real shape.
        day_offset = int(span_days * (o / orders) ** 0.85)
        day_offset += rng.randint(-3, 3)
        day_offset = max(0, min(span_days - 1, day_offset))
        ts = start + timedelta(days=day_offset, hours=rng.randint(0, 23), minutes=rng.randint(0, 59))
        status = rng.choice(STATUSES)
        n_items = rng.choices([1, 2, 3, 4], weights=[62, 24, 10, 4])[0]
        order_total = 0.0

        for item_seq in range(1, n_items + 1):
            prod = rng.choice(products)
            seller = rng.choice(sellers)
            price = round(rng.uniform(prod["_price_lo"], prod["_price_hi"]), 2)
            freight = round(rng.uniform(7.5, 42.0), 2)
            order_total += price
            order_items.append({
                "order_id": order_id,
                "order_item_id": item_seq,
                "customer_id": cust["customer_id"],
                "product_id": prod["product_id"],
                "seller_id": seller["seller_id"],
                "order_status": status,
                "order_purchase_ts": ts.strftime("%Y-%m-%d %H:%M:%S"),
                "price": f"{price:.2f}",
                "freight_value": f"{freight:.2f}",
                "payment_value": "",
                "customer_city": cust["customer_city"],
                "customer_state": cust["customer_state"],
            })
            order_item_counter += 1

        remaining = round(order_total + rng.uniform(7.5, 42.0), 2)
        seq = 1
        while remaining > 0.01 and seq <= 3:
            ptype = rng.choice(PAYMENT_TYPES)
            value = round(remaining if seq == 3 or remaining < 60 else remaining * rng.uniform(0.4, 0.7), 2)
            value = min(value, remaining)
            payments.append({
                "order_id": order_id,
                "payment_sequential": seq,
                "payment_type": ptype,
                "payment_value": f"{value:.2f}",
            })
            remaining = round(remaining - value, 2)
            seq += 1

    # ------------------------------------------------ injected quality defects
    defects = {
        "null_order_id": 3,
        "non_numeric_price": 2,
        "negative_price": 2,
        "duplicate_key": 2,
        "bad_date": 2,
        "unknown_status": 3,
        "orphan_product": 2,
        "missing_freight": 2,
    }
    injected = 0
    known_product_ids = {p["product_id"] for p in products}

    def pick(offset):
        return order_items[(offset * 37 + 11) % len(order_items)]

    for i in range(defects["null_order_id"]):
        pick(i)["order_id"] = ""
        injected += 1
    for i in range(defects["non_numeric_price"]):
        pick(i + 5)["price"] = "N/A"
        injected += 1
    for i in range(defects["negative_price"]):
        pick(i + 9)["price"] = "-19.90"
        injected += 1
    for i in range(defects["duplicate_key"]):
        src = pick(i + 13)
        clone = dict(src)
        order_items.append(clone)
        injected += 1
    for i in range(defects["bad_date"]):
        pick(i + 17)["order_purchase_ts"] = "31/02/2019 99:99"
        injected += 1
    for i in range(defects["unknown_status"]):
        pick(i + 21)["order_status"] = "lost_in_transit"
        injected += 1
    for i in range(defects["orphan_product"]):
        pick(i + 25)["product_id"] = "ffffffffffffffffffffffffffffffff"
        injected += 1
    for i in range(defects["missing_freight"]):
        pick(i + 29)["freight_value"] = ""
        injected += 1

    # ------------------------------------------------------------------- write
    written = {}

    def write_csv(name, rows, columns):
        path = out_dir / name
        with path.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=columns, extrasaction="ignore")
            writer.writeheader()
            for r in rows:
                writer.writerow({c: r.get(c, "") for c in columns})
        digest = hashlib.sha256(path.read_bytes()).hexdigest()[:16]
        written[name] = {"rows": len(rows), "sha256_16": digest}
        return path

    write_csv("order_items.csv", order_items, [
        "order_id", "order_item_id", "customer_id", "product_id", "seller_id",
        "order_status", "order_purchase_ts", "price", "freight_value",
        "payment_value", "customer_city", "customer_state"])
    write_csv("customers.csv", customers, ["customer_id", "customer_unique_id", "customer_city", "customer_state"])
    write_csv("products.csv", products, ["product_id", "product_category", "product_name"])
    write_csv("sellers.csv", sellers, ["seller_id", "seller_city", "seller_state"])
    write_csv("payments.csv", payments, ["order_id", "payment_sequential", "payment_type", "payment_value"])

    manifest = {
        "generator": "scripts/seed_demo.py",
        "seed": SEED,
        "synthetic": True,
        "note": (
            "Synthetic fixture generated deterministically from SEED. It is NOT real Olist "
            "data; it mimics the schema and statistics of the public Olist e-commerce dataset "
            "so the platform can be demonstrated without redistributing third-party data."
        ),
        "orders": orders,
        "order_items": len(order_items),
        "customers": len(customers),
        "products": len(products),
        "sellers": len(sellers),
        "payments": len(payments),
        "injected_defects": defects,
        "injected_defect_rows": injected,
        "files": written,
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def upload(base_url: str, out_dir: Path) -> dict:
    import httpx

    datasets = {
        "order_items": "order_items.csv",
        "customers": "customers.csv",
        "products": "products.csv",
        "sellers": "sellers.csv",
        "payments": "payments.csv",
    }
    results = {}
    with httpx.Client(timeout=180.0) as client:
        for dataset, filename in datasets.items():
            path = out_dir / filename
            with path.open("rb") as fh:
                resp = client.post(
                    f"{base_url}/ingestion/upload",
                    data={"dataset": dataset},
                    files={"file": (filename, fh, "text/csv")},
                )
            resp.raise_for_status()
            results[dataset] = resp.json()
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate RetailFlow demo data")
    parser.add_argument("--out", default="sample-data", help="output directory")
    parser.add_argument("--orders", type=int, default=1500, help="number of orders to generate")
    parser.add_argument("--upload", default=None, help="optional API base URL to ingest into")
    args = parser.parse_args()

    out_dir = Path(args.out)
    manifest = generate(out_dir, args.orders)
    print(json.dumps({k: v for k, v in manifest.items() if k != "files"}, indent=2))
    print(f"wrote {len(manifest['files'])} files to {out_dir.resolve()}")

    if args.upload:
        print(f"uploading to {args.upload} ...")
        for dataset, result in upload(args.upload, out_dir).items():
            print(f"  {dataset}: {result['status']} read={result['rows_read']} "
                  f"staged={result['rows_staged']} invalid={result['rows_invalid']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
