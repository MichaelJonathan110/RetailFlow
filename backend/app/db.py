"""Database engine and session management."""
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings

settings = get_settings()

engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    """FastAPI dependency: yields a session and always closes it."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    """Transactional scope for background/CLI work."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def check_database() -> dict:
    """Real connectivity probe used by /health. Never raises."""
    try:
        with engine.connect() as conn:
            version = conn.execute(text("SELECT version()")).scalar_one()
            schemas = conn.execute(
                text(
                    "SELECT count(*) FROM information_schema.schemata "
                    "WHERE schema_name IN ('app','ops','staging','warehouse','analytics')"
                )
            ).scalar_one()
        return {"connected": True, "server_version": str(version).split(",")[0], "schemas_present": int(schemas)}
    except Exception as exc:  # noqa: BLE001 - health checks must never raise
        return {"connected": False, "error": type(exc).__name__, "detail": str(exc)[:200]}
