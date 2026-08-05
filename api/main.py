"""uvicorn entrypoint: `uvicorn main:app --reload`"""

from app.presentation.app import app

__all__ = ["app"]
