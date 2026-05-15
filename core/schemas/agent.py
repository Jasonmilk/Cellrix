"""
Agent API Contract Models (P1a/P1b)

Defines Pydantic models for the Agent Accessibility HTTP endpoints.
All models use strict mode to reject unknown fields and type mismatches.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


class ViewportMeta(BaseModel):
    """Metadata about the current terminal or viewport."""

    model_config = ConfigDict(strict=True)

    width: int = Field(..., ge=1, description="Visible columns")
    height: int = Field(..., ge=1, description="Visible rows")


class CellEntity(BaseModel):
    """Represents a single cell (node) in the semantic tree snapshot."""

    model_config = ConfigDict(strict=True)

    id: str
    role: str
    type: str
    summary: str
    available_actions: list[str] = Field(default_factory=list)
    children: list[CellEntity] = Field(default_factory=list)


class SnapshotResponse(BaseModel):
    """Response for GET /v1/agent/snapshot."""

    model_config = ConfigDict(strict=True)

    viewport: ViewportMeta
    cells: list[CellEntity]


class ActionRequest(BaseModel):
    """Request body for POST /v1/agent/action."""

    model_config = ConfigDict(strict=True)

    action: str = Field(..., min_length=1)
    payload: dict[str, Any] | None = None


class ActionResponse(BaseModel):
    """Response for POST /v1/agent/action."""

    model_config = ConfigDict(strict=True)

    success: bool
    message: str
    action_taken: str
