"""Manifest template generators."""

from pathlib import Path

from core.manifest.models import (
    Cell,
    CellManifest,
    CellType,
    Layout,
    Slot,
    Source,
)


def generate_claude_style() -> CellManifest:
    """Return a minimal Claude Code-like layout."""
    return CellManifest(
        version="2.0",
        layout=Layout(
            direction="vertical",
            slots=[
                Slot(id="chat", weight=3),
                Slot(id="approval_bar", weight=1),
            ],
        ),
        cells=[
            Cell(  # type: ignore[call-arg]
                id="conversation",
                type=CellType.DYNAMIC,
                slot="chat",
                source=Source(  # type: ignore[call-arg]
                    type="pipe",
                    command="cat",
                    schema_=None,
                ),
            ),
            Cell(  # type: ignore[call-arg]
                id="tool_approval",
                type=CellType.STATIC,
                slot="approval_bar",
                content="[Enter] Approve  [Esc] Reject",
            ),
        ],
    )


def write_template(template: CellManifest, path: Path) -> None:
    """Write a manifest to JSON file."""
    path.write_text(template.model_dump_json(indent=2, by_alias=True), encoding="utf-8")
