"""Vercel serverless entrypoint for the RetailFlow FastAPI app.

Vercel's Python runtime imports this module and looks for a top-level ASGI
callable. We re-export the real application from app.main so that the local
`uvicorn app.main:app` workflow and this deployment share one code path.
"""
import os
import sys

# Make the backend root importable (Vercel runs from the project root).
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.main import app  # noqa: E402,F401

__all__ = ["app"]
