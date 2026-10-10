"""Consistent error envelope for every API failure."""
from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class AppError(Exception):
    """Domain error carrying an HTTP status and a stable machine code."""

    def __init__(self, message: str, *, status_code: int = 400, code: str = "bad_request", details=None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.details = details


class NotFoundError(AppError):
    def __init__(self, message: str = "Resource not found", **kw):
        super().__init__(message, status_code=404, code="not_found", **kw)


class ConflictError(AppError):
    def __init__(self, message: str, **kw):
        super().__init__(message, status_code=409, code="conflict", **kw)


class ValidationError(AppError):
    def __init__(self, message: str, **kw):
        super().__init__(message, status_code=422, code="validation_failed", **kw)


def _payload(code: str, message: str, details=None) -> dict:
    body = {"error": {"code": code, "message": message}}
    if details is not None:
        body["error"]["details"] = details
    return body


def register_error_handlers(app) -> None:
    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError):
        return JSONResponse(status_code=exc.status_code, content=_payload(exc.code, exc.message, exc.details))

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException):
        return JSONResponse(status_code=exc.status_code, content=_payload(f"http_{exc.status_code}", str(exc.detail)))

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, exc: RequestValidationError):
        return JSONResponse(
            status_code=422,
            content=_payload("validation_failed", "Request validation failed", exc.errors()),
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception):
        # Never leak stack traces or credentials to the client.
        return JSONResponse(
            status_code=500,
            content=_payload("internal_error", "An unexpected internal error occurred."),
        )
