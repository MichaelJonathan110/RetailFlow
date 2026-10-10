"""Authentication: password hashing, signed session tokens, request gate.

Design goals:
* Zero new dependencies - PBKDF2-HMAC-SHA256 and HMAC-SHA256 come from the stdlib.
* Stateless tokens: the API can restart or scale without losing sessions.
* OFF by default (AUTH_ENABLED=false) so local demos and the existing test suite
  keep working unchanged; flip the flag for any real deployment.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse

from .config import get_settings

_ITERATIONS = 240_000
_ALGO = "pbkdf2_sha256"


def _b64e(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _b64d(txt: str) -> bytes:
    pad = "=" * (-len(txt) % 4)
    return base64.urlsafe_b64decode(txt + pad)


def hash_password(password: str) -> str:
    """Return a self-describing PBKDF2 hash: algo$iterations$salt$digest."""
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _ITERATIONS)
    return f"{_ALGO}${_ITERATIONS}${_b64e(salt)}${_b64e(dk)}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored or "$" not in stored:
        return False
    try:
        algo, iters, salt_b64, hash_b64 = stored.split("$")
        if algo != _ALGO:
            return False
        dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), _b64d(salt_b64), int(iters))
    except Exception:
        return False
    return hmac.compare_digest(_b64e(dk), hash_b64)


def _secret() -> bytes:
    settings = get_settings()
    material = settings.auth_secret or f"{settings.app_name}:{settings.database_url}"
    return hashlib.sha256(material.encode("utf-8")).digest()


def create_token(user: dict[str, Any]) -> str:
    settings = get_settings()
    payload = {
        "sub": str(user.get("user_id")),
        "email": user.get("email"),
        "name": user.get("full_name"),
        "role": user.get("role"),
        "exp": int(time.time()) + settings.auth_token_ttl_minutes * 60,
    }
    body = _b64e(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    sig = _b64e(hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest())
    return f"{body}.{sig}"


def decode_token(token: str | None) -> dict[str, Any] | None:
    if not token or "." not in token:
        return None
    body, _, sig = token.partition(".")
    expected = _b64e(hmac.new(_secret(), body.encode("ascii"), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        payload = json.loads(_b64d(body).decode("utf-8"))
    except Exception:
        return None
    if int(payload.get("exp", 0)) < int(time.time()):
        return None
    return payload


def bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization") or ""
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return None


def current_user(request: Request) -> dict[str, Any] | None:
    cached = getattr(request.state, "user", None)
    if cached is not None:
        return cached
    return decode_token(bearer_token(request))


# Paths (relative to API_PREFIX) that stay reachable without a token.
PUBLIC_TAILS = ("/health", "/health/ready", "/auth/login")


async def auth_gate(request: Request, call_next):
    """HTTP middleware: when AUTH_ENABLED, every API route needs a Bearer token."""
    settings = get_settings()
    path = request.url.path
    if settings.auth_enabled and path.startswith(settings.api_prefix) and request.method != "OPTIONS":
        tail = path[len(settings.api_prefix):] or "/"
        if not any(tail == p or tail.startswith(p + "/") for p in PUBLIC_TAILS):
            user = current_user(request)
            if user is None:
                return JSONResponse(
                    status_code=401,
                    content={
                        "error": {
                            "code": "unauthorized",
                            "message": "Authentication required. Send a valid Bearer token.",
                        }
                    },
                )
            request.state.user = user
    return await call_next(request)


def seed_admin_user() -> str:
    """Create the bootstrap admin from the environment when the table is empty.

    Best-effort: never raises, so a schema quirk cannot stop the API booting.
    """
    settings = get_settings()
    if not settings.auth_enabled:
        return "skipped_auth_disabled"
    if not settings.auth_admin_email or not settings.auth_admin_password:
        return "skipped_no_credentials"
    try:
        from sqlalchemy import text

        from .db import SessionLocal

        with SessionLocal() as db:
            existing = db.execute(
                text("SELECT count(*) FROM app.app_user WHERE lower(email) = lower(:e)"),
                {"e": settings.auth_admin_email},
            ).scalar_one()
            if existing:
                return "skipped_existing_admin"
            db.execute(
                text(
                    "INSERT INTO app.app_user (email, full_name, role, password_hash, is_active) "
                    "VALUES (:e, :n, :r, :h, true)"
                ),
                {
                    "e": settings.auth_admin_email,
                    "n": settings.auth_admin_name,
                    "r": settings.auth_admin_role,
                    "h": hash_password(settings.auth_admin_password),
                },
            )
            db.commit()
        return "created"
    except Exception as exc:  # noqa: BLE001 - seeding must never break startup
        return "error:" + type(exc).__name__ + ":" + str(exc)[:160]
