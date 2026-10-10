"""Authentication endpoints: login, current user, logout."""
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_db
from ..errors import AppError
from ..security import create_token, current_user, verify_password

router = APIRouter(tags=["auth"])


class LoginRequest(BaseModel):
    email: str = Field(max_length=200)
    password: str = Field(max_length=200)


def require_user(request: Request) -> dict:
    """Dependency: the authenticated user, or a 401 in the standard envelope."""
    settings = get_settings()
    if not settings.auth_enabled:
        return {"user_id": None, "email": None, "full_name": None, "role": "anonymous"}
    user = current_user(request)
    if user is None:
        raise AppError("Authentication required", status_code=401, code="unauthorized")
    return user


@router.post("/auth/login")
def login(body: LoginRequest, db: Session = Depends(get_db)):
    row = db.execute(
        text(
            "SELECT user_id, email, full_name, role, password_hash, is_active "
            "FROM app.app_user WHERE lower(email) = lower(:e)"
        ),
        {"e": body.email},
    ).mappings().first()
    if not row or not row["is_active"] or not verify_password(body.password, row["password_hash"]):
        raise AppError("Invalid email or password", status_code=401, code="invalid_credentials")
    user = {
        "user_id": row["user_id"],
        "email": row["email"],
        "full_name": row["full_name"],
        "role": row["role"],
    }
    settings = get_settings()
    return {
        "token": create_token(user),
        "token_type": "bearer",
        "expires_in": settings.auth_token_ttl_minutes * 60,
        "user": user,
    }


@router.get("/auth/me")
def me(user: dict = Depends(require_user)):
    return {"user": user}


@router.post("/auth/logout")
def logout(user: dict = Depends(require_user)):
    return {"ok": True, "note": "Tokens are stateless; discard the token client-side."}
