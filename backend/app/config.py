"""Runtime configuration. Secrets come from the environment only."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# VERCEL_EXPLORER_OPTIN
# The public demo deployment runs on Vercel (which sets VERCEL=1). Opt that
# runtime into the read-only SQL explorer; local and CI keep the safe default
# (off). An explicit SQL_EXPLORER_ENABLED env var always wins.
import os as _os
if _os.environ.get("VERCEL"):
    _os.environ.setdefault("SQL_EXPLORER_ENABLED", "true")


# The single source of truth for local config is the repo-root .env (see
# .env.example). Resolve it relative to this file so the settings are identical
# whether the process is started from the repo root, from backend/, or by pytest.
_REPO_ROOT = Path(__file__).resolve().parents[2]
_ENV_FILES = (str(_REPO_ROOT / ".env"), ".env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILES, extra="ignore", case_sensitive=False)

    app_name: str = "RetailFlow"
    app_env: str = "development"
    api_prefix: str = "/api/v1"
    log_level: str = "INFO"

    database_url: str = (
        "postgresql+psycopg://retailflow:change-me-local-dev@localhost:5434/retailflow"
    )

    cors_origins: str = "http://localhost:3000,http://localhost:5173,http://127.0.0.1:3000,http://127.0.0.1:5173,https://retail-flow-app-mekjo.vercel.app,https://retail-flow-app.vercel.app,https://retail-flow-app-git-main-mekjo.vercel.app"

    max_upload_mb: int = 50
    max_upload_rows: int = 500_000
    upload_dir: str = "./uploads"

    default_currency: str = "BRL"
    default_timezone: str = "UTC"
    default_page_size: int = 25
    max_page_size: int = 200

    auth_enabled: bool = False
    auth_secret: str = ""
    auth_token_ttl_minutes: int = 480
    auth_admin_email: str = ""
    auth_admin_name: str = "RetailFlow Admin"
    auth_admin_role: str = "administrator"
    auth_admin_password: str = ""
    demo_data_enabled: bool = True

    # Safety rails for the read-only SQL explorer.
    sql_explorer_enabled: bool = False
    sql_statement_timeout_ms: int = 5000

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
