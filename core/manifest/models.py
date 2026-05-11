"""Pydantic models for Cell-Manifest v2.3."""

from enum import StrEnum
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class CellType(StrEnum):
    STATIC = "static"
    DYNAMIC = "dynamic"
    REALTIME = "realtime"


class SecurityClass(StrEnum):
    SAFE = "safe"
    RESTRICTED = "restricted"
    CRITICAL = "critical"


class ApprovalRequirement(BaseModel):
    prompt: str
    timeout: int = 30000
    timeout_action: Literal["reject", "approve"] = Field("reject", alias="timeoutAction")
    fallback_emit: str = Field(..., alias="fallbackEmit")


class KeyBinding(BaseModel):
    """A single keybinding with optional visual enhancement (v2.3)."""
    key: str
    intent: str = ""  # emit
    label: Optional[str] = None
    style: Optional[Literal["primary", "secondary", "success", "danger", "warning", "info"]] = None
    show_key: bool = True
    hint: Optional[str] = None


class ActionDef(BaseModel):
    target: str | None = None
    emit: str
    security_class: SecurityClass = Field(SecurityClass.SAFE, alias="securityClass")
    requires_approval: ApprovalRequirement | None = Field(None, alias="requiresApproval")
    payload: dict[str, Any] = Field(default_factory=dict)


class Actions(BaseModel):
    on_press: ActionDef | None = Field(None, alias="onPress")
    on_focus: ActionDef | None = Field(None, alias="onFocus")
    on_key: list[KeyBinding] | None = Field(None, alias="onKey")


class Source(BaseModel):
    type: Literal["pipe", "file", "socket"]
    command: str | None = None
    protocol: Literal["json", "protobuf"] | None = None
    schema_: str | None = Field(None, alias="schema")


class Cell(BaseModel):
    id: str
    type: CellType
    slot: str
    content: str | None = None
    content_type: Optional[Literal["text", "markdown", "code"]] = Field("text", alias="content_type")
    source: Source | None = None
    driver: str | None = None
    driver_config: dict[str, Any] | None = Field(None, alias="driverConfig")
    actions: Actions | None = None
    min_constraint: dict[str, int] | None = Field(None, alias="minConstraint")
    collapse_mode: Literal["scroll", "truncate"] | None = Field("scroll", alias="collapseMode")
    priority: int = 50
    semantic_widget: Optional[
        Literal["text", "table", "list", "progress", "input", "modal", "tree"]
    ] = Field(None, alias="semantic_widget")
    semantic_data: Optional[Any] = Field(None, alias="semantic_data")
    language: str | None = None


class Slot(BaseModel):
    id: str
    weight: int = 1
    layout: Optional['Layout'] = None


class Layout(BaseModel):
    direction: Literal["horizontal", "vertical"]
    slots: list[Slot]


class Capabilities(BaseModel):
    network: list[str] = Field(default_factory=list)
    fs_read: list[str] = Field(default_factory=list, alias="fs.read")
    fs_write: list[str] = Field(default_factory=list, alias="fs.write")
    process_spawn: bool = Field(False, alias="process.spawn")
    drivers: list[str] = Field(default_factory=list)
    actions_emit: list[str] = Field(default_factory=list, alias="actions.emit")


class CellManifest(BaseModel):
    version: str
    capabilities: Capabilities | None = None
    layout: Layout
    cells: list[Cell]
