from fastapi import APIRouter

from .. import __version__
from ..config import get_settings
from ..db import check_database

router = APIRouter(tags=["health"])


@router.get("/health")
def health():
    """Liveness + real database connectivity. Never raises."""
    settings = get_settings()
    db = check_database()
    return {
        "status": "ok" if db["connected"] else "degraded",
        "version": __version__,
        "environment": settings.app_env,
        "auth_enabled": settings.auth_enabled,
        "database": db,
    }


@router.get("/health/ready")
def ready():
    db = check_database()
    if not db["connected"]:
        return {"ready": False, "database": db}
    return {"ready": True, "database": db}
