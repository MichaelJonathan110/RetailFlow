"""Unit tests for the data-quality rule engine."""
from app.services.rules import Rule, build_rules


def test_not_null_fails_on_blank_and_missing():
    rule = Rule("R", "not_null:order_id")
    assert rule.evaluate({"order_id": ""}).failed is True
    assert rule.evaluate({}).failed is True
    assert rule.evaluate({"order_id": "abc"}).failed is False


def test_is_integer_rejects_non_numeric():
    rule = Rule("R", "is_integer:order_item_id")
    assert rule.evaluate({"order_item_id": "2"}).failed is False
    assert rule.evaluate({"order_item_id": "two"}).failed is True


def test_is_numeric_and_non_negative():
    numeric = Rule("R", "is_numeric:price")
    assert numeric.evaluate({"price": "12.50"}).failed is False
    assert numeric.evaluate({"price": "N/A"}).failed is True

    nonneg = Rule("R", "non_negative:price")
    assert nonneg.evaluate({"price": "-1"}).failed is True
    assert nonneg.evaluate({"price": "0"}).failed is False


def test_valid_timestamp_accepts_common_formats():
    rule = Rule("R", "valid_timestamp:order_purchase_ts")
    assert rule.evaluate({"order_purchase_ts": "2018-03-04 10:11:12"}).failed is False
    assert rule.evaluate({"order_purchase_ts": "2018-03-04"}).failed is False
    assert rule.evaluate({"order_purchase_ts": "31/02/2019 99:99"}).failed is True


def test_date_in_range_flags_outliers():
    rule = Rule("R", "date_in_range:order_purchase_ts:2016-01-01:2020-12-31")
    assert rule.evaluate({"order_purchase_ts": "2018-06-01"}).failed is False
    assert rule.evaluate({"order_purchase_ts": "2015-12-31"}).failed is True
    assert rule.evaluate({"order_purchase_ts": "2021-01-01"}).failed is True


def test_allowed_values_membership():
    rule = Rule("R", "allowed_values:order_status:delivered,shipped")
    assert rule.evaluate({"order_status": "Delivered"}).failed is False
    assert rule.evaluate({"order_status": "lost_in_transit"}).failed is True


def test_ref_exists_uses_reference_set():
    rule = Rule("R", "ref_exists:product_id:dim_product", reference_ids={"p1", "p2"})
    assert rule.evaluate({"product_id": "p1"}).failed is False
    assert rule.evaluate({"product_id": "missing"}).failed is True


def test_unique_key_detects_duplicates():
    seen: set = set()
    rule = Rule("R", "unique_key:order_id+order_item_id")
    first = rule.evaluate({"order_id": "o1", "order_item_id": "1", "__seen_keys__": seen})
    second = rule.evaluate({"order_id": "o1", "order_item_id": "1", "__seen_keys__": seen})
    third = rule.evaluate({"order_id": "o1", "order_item_id": "2", "__seen_keys__": seen})
    assert first.failed is False
    assert second.failed is True
    assert third.failed is False


def test_unknown_check_fails_loudly():
    """A typo in a rule expression must not silently pass."""
    rule = Rule("R", "telepathy:price")
    outcome = rule.evaluate({"price": "1"})
    assert outcome.failed is True
    assert "unsupported" in (outcome.reason or "")


def test_build_rules_attaches_reference_sets():
    rows = [{"rule_code": "A", "expression": "ref_exists:product_id:dim_product"},
            {"rule_code": "B", "expression": "not_null:order_id"}]
    rules = build_rules(rows, {"dim_product": {"p1"}})
    assert rules[0].reference_ids == {"p1"}
    assert rules[1].reference_ids == set()
