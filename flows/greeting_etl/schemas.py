"""Typed contracts for this flow's E/T/L stages. Flow-local — a model only
shared across flows belongs somewhere shared, not copy-pasted per folder."""

from __future__ import annotations

from pydantic import BaseModel, Field


class GreetingInput(BaseModel):
    name: str = Field(..., min_length=1, description="Who to greet")


class RawName(BaseModel):
    name: str


class GreetingResult(BaseModel):
    name: str
    message: str
