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


class CapabilityManifest(BaseModel):
    """Response for GET /v1/cap/manifest.

    Declares the runtime's capabilities and protocol support.
    """

    model_config = ConfigDict(strict=True)

    runtime: str = "Cellrix"
    version: str
    capabilities: dict[str, bool]
    trace_id_support: bool = True


class DecisionRequest(BaseModel):
    """Request body for POST /v1/cap/decisions."""

    model_config = ConfigDict(strict=True)

    decision_id: str
    approval: bool
    trace_id: str | None = None


class DecisionStatusResponse(BaseModel):
    """Response for GET /v1/cap/decisions/{id}."""

    model_config = ConfigDict(strict=True)

    decision_id: str
    status: str  # "pending", "approved", "rejected", "unknown"
    trace_id: str | None = None


# ---------------------------------------------------------------------------
# CIS intent registry models (aligned with CIS v0.6.0)
# ---------------------------------------------------------------------------

class CISSecurity(BaseModel):
    """Security constraints for a CIS intent."""

    model_config = ConfigDict(strict=True)

    risk_level: Literal["low", "medium", "high", "critical"] = "low"
    requires_hitl: bool = False
    required_scopes: list[str] = Field(default_factory=list)


class CISBinding(BaseModel):
    """Binding declaration for a CIS intent."""

    model_config = ConfigDict(strict=True)

    type: str = "ui_element"
    target_id: str


class CISIntent(BaseModel):
    """A single intent in the registry."""

    model_config = ConfigDict(strict=True)

    id: str
    name: str
    description: str
    parameters: dict | None = None  # Raw JSON Schema, never parsed further
    security: CISSecurity | None = None
    bindings: list[CISBinding] | None = None


class CISRegistry(BaseModel):
    """Root object of a CIS intent registry file."""

    model_config = ConfigDict(strict=True)

    schema_: str | None = Field(default=None, alias="$schema")
    cis_version: str = "0.6"
    interface_id: str | None = None
    intents: list[CISIntent] = Field(default_factory=list)
