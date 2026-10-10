"""Shared pytest fixtures.

Database-dependent tests are skipped automatically when PostgreSQL is unreachable, so a checkout
without Docker still yields a meaningful partial run instead of a wall of connection errors.
"""
import os
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

# The auth gate is covered by tests/test_auth.py; the rest of the suite
# exercises the API surface, so force it off here regardless of .env.
os.environ["AUTH_ENABLED"] = "false"

os.environ.setdefault("DATABASE_URL", "postgresql+psycopg://retailflow:change-me-local-dev@localhost:5434/retailflow")


def _db_available() -> bool:
    try:
        from app.db import check_database
        return bool(check_database()["connected"])
    except Exception:  # noqa: BLE001
        return False


DB_AVAILABLE = _db_available()

# In CI the database is a service container that MUST be up. Without this guard the
# database-backed tests would be SKIPPED and the job would pass green while proving
# nothing. REQUIRE_DB=1 turns that silent skip into a hard failure.
if os.environ.get("REQUIRE_DB") == "1" and not DB_AVAILABLE:
    raise RuntimeError(
        "REQUIRE_DB=1 but PostgreSQL is not reachable - refusing to skip the "
        "database-backed tests silently."
    )

needs_db = pytest.mark.skipif(not DB_AVAILABLE, reason="PostgreSQL is not reachable; start it with docker compose up -d postgres")


@pytest.fixture(scope="session")
def client():
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as c:
        yield c
