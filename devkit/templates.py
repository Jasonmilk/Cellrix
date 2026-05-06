"""Manifest template generators."""

from pathlib import Path

from core.manifest.models import Cell, CellManifest, CellType, Layout, Slot


def generate_claude_style() -> CellManifest:
    """Return a minimal Claude Code-like layout."""
    # placeholder implementation
    return CellManifest(
        version="2.0",
        layout=Layout(direction="vertical", slots=[
            Slot(id="chat", weight=3),
            Slot(id="approval_bar", weight=1)
        ]),
        cells=[
            Cell(id="conversation", type=CellType.DYNAMIC, slot="chat", source={"type": "pipe", "command": "cat"}),
            Cell(id="tool_approval", type=CellType.STATIC, slot="approval_bar", content="[Enter] Approve  [Esc] Reject")
        ]
    )

def write_template(template: CellManifest, path: Path):
    """Write a manifest to JSON file."""
    path.write_text(template.model_dump_json(indent=2), encoding="utf-8")
