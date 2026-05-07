"""TextualCellrixApp — a Textual App that reads a Cell-Manifest and renders it,
and emits Cellrix Action JSON on user interactions."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Optional

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical, ScrollableContainer, Center
from textual.screen import ModalScreen
from textual.widgets import Static, Label, Button

from core.manifest.parser import parse_manifest
from core.manifest.models import CellManifest


# ─────────────────────────────── Help Screen ───────────────────────────────
class HelpScreen(ModalScreen):
    """A full‑screen modal help overlay."""

    BINDINGS = [
        Binding("escape", "dismiss", "Close Help"),
    ]

    def compose(self) -> ComposeResult:
        with Vertical():
            with ScrollableContainer():
                yield Label("""
Shortcuts:

  q         Quit Cellrix
  Tab       Focus next panel
  Shift+Tab Focus previous panel
  F1        Show this help

Press Escape (or click outside) to close.
                """)
            with Center():
                yield Button("Close Help", variant="primary", action="dismiss")


# ─────────────────────────── Main Application ──────────────────────────────
class TextualCellrixApp(App):
    """A Textual application that boots from a Cell-Manifest.

    By default, every keypress that maps to a known Cellrix action
    is printed to stdout as a Cellrix Action JSON line.
    """

    CSS = """
    Screen {
        align: center top;
    }

    Horizontal {
        width: 100%;
        height: 100%;
    }

    Vertical {
        width: 100%;
        height: 100%;
    }

    .cell {
        border: solid $panel;
        padding: 0 1;
        width: 1fr;
        height: 100%;
    }

    .cell:focus {
        border: solid $success;
    }
    """

    # Standard Cellrix action definitions (CIS §8)
    ACTION_FOCUS_NEXT = "focus_next"
    ACTION_FOCUS_PREV = "focus_prev"
    ACTION_TOGGLE_HELP = "toggle_help"
    ACTION_QUIT = "quit"

    BINDINGS = [
        Binding("q", "emit_quit", "Quit"),
        Binding("tab", "emit_focus_next", "Next Panel", show=False),
        Binding("shift+tab", "emit_focus_prev", "Prev Panel", show=False),
        Binding("f1", "emit_toggle_help", "Help"),
    ]

    def __init__(
        self,
        manifest_path: str | Path,
        strict: bool = False,
        emit_events: bool = True,            # ← set to False to run silently
    ) -> None:
        self.manifest_path = Path(manifest_path)
        self.strict = strict
        self.emit_events = emit_events
        self.manifest: Optional[CellManifest] = None
        super().__init__()

    # ── Composition ──────────────────────────────────────────────────────
    def compose(self) -> ComposeResult:
        """Parse manifest and yield the widget tree."""
        try:
            self.manifest = parse_manifest(self.manifest_path, strict=self.strict)
        except Exception as e:
            yield Static(f"Error parsing manifest: {e}")
            return

        if (
            len(self.manifest.cells) == 1
            and not any(s.layout for s in self.manifest.layout.slots)
        ):
            cell = self.manifest.cells[0]
            w = Static(cell.content or cell.id, classes="cell")
            w.can_focus = True
            yield w
            return

        yield self._build_layout(self.manifest)

    def _build_layout(self, manifest: CellManifest):
        """Recursively build a layout container from a Cell-Manifest."""
        slot_cells: dict[str, list] = {}
        for cell in manifest.cells:
            slot_cells.setdefault(cell.slot, []).append(cell)

        children = []
        for slot in manifest.layout.slots:
            if slot.layout is not None:
                sub_manifest = CellManifest(
                    version=manifest.version,
                    layout=slot.layout,
                    cells=[
                        c
                        for c in manifest.cells
                        if c.slot in {s.id for s in slot.layout.slots}
                    ],
                )
                children.append(self._build_layout(sub_manifest))
            else:
                cell = slot_cells.get(slot.id, [None])[0]
                if cell is not None:
                    w = Static(cell.content or cell.id, classes="cell")
                else:
                    w = Static("")
                w.can_focus = True
                children.append(w)

        if manifest.layout.direction == "horizontal":
            return Horizontal(*children)
        return Vertical(*children)

    # ── Event Emitters (output JSON to stdout) ────────────────────────────
    def _emit(self, action: str, cell_id: str | None = None, payload: dict | None = None) -> None:
        """Print a single Cellrix Action JSON line to stdout."""
        if not self.emit_events:
            return
        msg = {
            "event": "cellrix.action",
            "action": action,
            "cell_id": cell_id or "",
            "payload": payload or {},
        }
        print(json.dumps(msg), flush=True)

    def action_emit_focus_next(self) -> None:
        self._emit(self.ACTION_FOCUS_NEXT)
        self.focus_next()

    def action_emit_focus_prev(self) -> None:
        self._emit(self.ACTION_FOCUS_PREV)
        self.focus_previous()

    def action_emit_toggle_help(self) -> None:
        self._emit(self.ACTION_TOGGLE_HELP)
        self.push_screen(HelpScreen())

    def action_emit_quit(self) -> None:
        self._emit(self.ACTION_QUIT)
        self.exit()


# ── CLI entry point ───────────────────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python app.py <manifest.json> [--no-emit]", file=sys.stderr)
        sys.exit(1)
    emit = True
    if "--no-emit" in sys.argv:
        emit = False
        sys.argv.remove("--no-emit")
    app = TextualCellrixApp(sys.argv[1], emit_events=emit)
    app.run()
