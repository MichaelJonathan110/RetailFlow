"""Data-quality rule engine.

A rule is a small expression of the form `<check>:<column>[:<arg>...]` stored in
ops.data_quality_rules.expression. This module turns that string into a callable
so new rules can be added as data, without touching application code.
"""
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation


@dataclass
class RuleOutcome:
    failed: bool
    reason: str | None = None


ALLOWED_STATUSES = {
    "delivered", "shipped", "canceled", "unavailable", "invoiced",
    "processing", "created", "approved",
}


def _is_blank(value) -> bool:
    return value is None or (isinstance(value, str) and value.strip() == "")


def _to_decimal(value) -> Decimal | None:
    if _is_blank(value):
        return None
    try:
        return Decimal(str(value).strip())
    except (InvalidOperation, ValueError, TypeError):
        return None


def _to_timestamp(value):
    if _is_blank(value):
        return None
    text = str(value).strip().replace("Z", "+00:00")
    for fmt in (None, "%Y-%m-%d %H:%M:%S", "%Y-%m-%d", "%d/%m/%Y %H:%M", "%d/%m/%Y"):
        try:
            return datetime.fromisoformat(text) if fmt is None else datetime.strptime(text, fmt)
        except (ValueError, TypeError):
            continue
    return None


def _to_date(value):
    ts = _to_timestamp(value)
    if ts is not None:
        return ts.date()
    if _is_blank(value):
        return None
    try:
        return date.fromisoformat(str(value).strip())
    except (ValueError, TypeError):
        return None


class Rule:
    """Parsed, reusable form of one rule expression."""

    def __init__(self, code: str, expression: str, *, reference_ids: set | None = None):
        self.code = code
        self.expression = expression
        self.reference_ids = reference_ids or set()
        parts = expression.split(":")
        self.check = parts[0].strip()
        self.column = parts[1].strip() if len(parts) > 1 else None
        self.args = [p.strip() for p in parts[2:]]

    def evaluate(self, row: dict) -> RuleOutcome:
        check = self.check

        if check == "not_null":
            value = row.get(self.column)
            if _is_blank(value):
                return RuleOutcome(True, f"{self.column} is empty")
            return RuleOutcome(False)

        if check == "is_integer":
            value = row.get(self.column)
            if _is_blank(value):
                return RuleOutcome(False)  # handled by not_null
            try:
                int(str(value).strip())
            except (ValueError, TypeError):
                return RuleOutcome(True, f"{self.column}='{value}' is not an integer")
            return RuleOutcome(False)

        if check == "is_numeric":
            value = row.get(self.column)
            if _is_blank(value):
                return RuleOutcome(False)
            if _to_decimal(value) is None:
                return RuleOutcome(True, f"{self.column}='{value}' is not numeric")
            return RuleOutcome(False)

        if check == "non_negative":
            value = row.get(self.column)
            if _is_blank(value):
                return RuleOutcome(False)
            dec = _to_decimal(value)
            if dec is None:
                return RuleOutcome(False)  # numeric check owns this
            if dec < 0:
                return RuleOutcome(True, f"{self.column}={dec} is negative")
            return RuleOutcome(False)

        if check == "valid_timestamp":
            value = row.get(self.column)
            if _is_blank(value):
                return RuleOutcome(False)
            if _to_timestamp(value) is None:
                return RuleOutcome(True, f"{self.column}='{value}' is not a valid date/time")
            return RuleOutcome(False)

        if check == "date_in_range":
            value = row.get(self.column)
            if _is_blank(value):
                return RuleOutcome(False)
            ts = _to_timestamp(value)
            if ts is None:
                return RuleOutcome(False)  # valid_timestamp owns this
            start = date.fromisoformat(self.args[0]) if len(self.args) > 0 else None
            end = date.fromisoformat(self.args[1]) if len(self.args) > 1 else None
            if start and ts.date() < start:
                return RuleOutcome(True, f"{self.column}={ts.date()} is before {start}")
            if end and ts.date() > end:
                return RuleOutcome(True, f"{self.column}={ts.date()} is after {end}")
            return RuleOutcome(False)

        if check == "allowed_values":
            value = row.get(self.column)
            if _is_blank(value):
                return RuleOutcome(False)
            allowed = {a for arg in self.args for a in arg.split(",") if a.strip()} or ALLOWED_STATUSES
            if str(value).strip().lower() not in {a.strip().lower() for a in allowed}:
                return RuleOutcome(True, f"{self.column}='{value}' is not an allowed value")
            return RuleOutcome(False)

        if check == "ref_exists":
            value = row.get(self.column)
            if _is_blank(value):
                return RuleOutcome(False)
            if self.reference_ids and str(value).strip() not in self.reference_ids:
                return RuleOutcome(True, f"{self.column}='{value}' has no matching {self.args[0] if self.args else 'reference'} row")
            return RuleOutcome(False)

        if check == "unique_key":
            key = "+".join([self.column] + self.args)
            values = tuple(str(row.get(c, "")).strip() for c in key.split("+"))
            seen = row.get("__seen_keys__")
            if seen is None:
                return RuleOutcome(False)
            if values in seen:
                return RuleOutcome(True, f"duplicate key {key}={values}")
            seen.add(values)
            return RuleOutcome(False)

        # Unknown check type: fail loudly at load time rather than silently passing.
        return RuleOutcome(True, f"unsupported rule check '{check}'")


def build_rules(rows: list[dict], reference_ids: dict[str, set] | None = None) -> list[Rule]:
    reference_ids = reference_ids or {}
    rules = []
    for r in rows:
        refs = set()
        expr = r["expression"]
        if expr.startswith("ref_exists:"):
            table = expr.split(":")[2]
            refs = reference_ids.get(table, set())
        rules.append(Rule(r["rule_code"], expr, reference_ids=refs))
    return rules
