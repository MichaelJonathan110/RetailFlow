"""RetailFlow API entrypoint."""
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .config import get_settings
from .db import check_database
from .errors import register_error_handlers
from .logging_conf import configure_logging
from .security import auth_gate, seed_admin_user
from .routers import (
    alerts,
    analytics,
    auth,
    explorer,
    freshness,
    health,
    ingestion,
    overview,
    pipelines,
    quality,
    runs,
    settings as settings_router,
    sources,
    warehouse,
)

settings = get_settings()
configure_logging(settings.log_level)


@asynccontextmanager
async def lifespan(app: FastAPI):
    db = check_database()
    app.state.db_connected_at_start = db["connected"]
    app.state.auth_seed = seed_admin_user()
    yield


app = FastAPI(
    title="RetailFlow API",
    version=__version__,
    description=(
        "RetailFlow - retail ETL automation, data quality and analytics over a "
        "PostgreSQL dimensional warehouse."
    ),
    openapi_url=f"{settings.api_prefix}/openapi.json",
    docs_url=f"{settings.api_prefix}/docs",
    redoc_url=f"{settings.api_prefix}/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Authentication gate (no-op unless AUTH_ENABLED=true). Runs INSIDE CORS so
# pre-flight OPTIONS requests are answered before the token check.
app.middleware("http")(auth_gate)


@app.middleware("http")
async def request_logging(request: Request, call_next):
    started = time.perf_counter()
    request_id = request.headers.get("x-request-id", str(uuid.uuid4()))
    response = await call_next(request)
    duration_ms = round((time.perf_counter() - started) * 1000, 2)
    response.headers["x-request-id"] = request_id
    response.headers["x-response-time-ms"] = str(duration_ms)
    return response


register_error_handlers(app)

for router in (
    health.router,
    auth.router,
    overview.router,
    sources.router,
    ingestion.router,
    pipelines.router,
    runs.router,
    quality.router,
    warehouse.router,
    analytics.router,
    alerts.router,
    explorer.router,
    freshness.router,
    settings_router.router,
):
    app.include_router(router, prefix=settings.api_prefix)


@app.get("/", include_in_schema=False)
def root():
    return {
        "name": settings.app_name,
        "version": __version__,
        "api": settings.api_prefix,
        "docs": f"{settings.api_prefix}/docs",
    }


@app.get("/health", include_in_schema=False)
async def health_root_alias():
    """Root-level alias for platform health checks (load balancers, uptime probes).

    The canonical endpoint is ``{api_prefix}/health``; this mirrors it at the
    bare ``/health`` path so infrastructure that cannot be told about the prefix
    still gets an answer.
    """
    from .routers.health import health as _health

    result = _health()
    if hasattr(result, "__await__"):
        result = await result
    return result
