"""System configuration and user settings."""
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..errors import ValidationError

router = APIRouter(tags=["settings"])


class SettingUpdate(BaseModel):
    value: str = Field(max_length=500)


@router.get("/settings")
def list_settings(db: Session = Depends(get_db)):
    rows = db.execute(text("""
        SELECT key, value, value_type, is_ui_editable, description,
               NULL::timestamptz AS updated_at
        FROM app.app_setting ORDER BY key
    """)).mappings()
    cfg = get_settings()
    return {
        "items": [dict(r) for r in rows],
        "runtime": {
            "app_env": cfg.app_env,
            "api_prefix": cfg.api_prefix,
            "auth_enabled": cfg.auth_enabled,
            "max_upload_mb": cfg.max_upload_mb,
            "max_upload_rows": cfg.max_upload_rows,
            "default_currency": cfg.default_currency,
            "default_timezone": cfg.default_timezone,
            "default_page_size": cfg.default_page_size,
            "sql_explorer_enabled": cfg.sql_explorer_enabled,
            "demo_data_enabled": cfg.demo_data_enabled,
        },
    }


@router.patch("/settings/{key}")
def update_setting(key: str, body: SettingUpdate, db: Session = Depends(get_db)):
    row = db.execute(text("""
        SELECT key, value_type, is_ui_editable FROM app.app_setting WHERE key = :k
    """), {"k": key}).mappings().first()
    if not row:
        raise ValidationError(f"Unknown setting '{key}'", details={"key": key})
    if not row["is_ui_editable"]:
        raise ValidationError(
            f"Setting '{key}' is environment-controlled and cannot be changed here",
            details={"key": key, "hint": "Set it through the environment / .env file."},
        )
    db.execute(text("""
        UPDATE app.app_setting SET value = :v WHERE key = :k
    """), {"v": body.value, "k": key})
    db.commit()
    return {"key": key, "value": body.value, "updated": True}
