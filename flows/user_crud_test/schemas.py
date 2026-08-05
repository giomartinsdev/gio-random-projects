"""Typed contracts for this flow. Mirrors api/domain's own User shape —
flow-local, not shared, because there's nothing else that needs it."""

from __future__ import annotations

from pydantic import BaseModel, Field


class UserPayload(BaseModel):
    name: str = Field(..., min_length=1)
    email: str = Field(..., min_length=3)


class UserResult(BaseModel):
    id: int
    name: str
    email: str
