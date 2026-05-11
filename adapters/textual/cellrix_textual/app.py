"""TextualCellrixApp — a Textual App that reads a Cell-Manifest and renders it,
and emits Cellrix Action JSON on user interactions."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Optional

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical, ScrollableContainer, Container
from textual.screen import ModalScreen
from textual.widgets import Static, Button, ProgressBar, DataTable

from core.manifest.parser import parse_manifest
from core.manifest.models import CellManifest, Cell


# ─────────────────────────────── Help Screen ───────────────────────────────
class HelpScreen(ModalScreen):
    """A polished full‑screen modal help overlay."""

    BINDINGS = [
        Binding("escape", "dismiss", "Close"),
        Binding("f1", "dismiss", "Close"),
    ]

    DEFAULT_CSS = """
    HelpScreen {
        align: center middle;
    }

    HelpScreen > Container {
        width: 80%;
        height: 80%;
        background: $surface;
        border: thick $accent;
        padding: 2 3;
    }

    HelpScreen .title {
        text-style: bold;
        color: $accent;
        padding-bottom: 1;
    }

    HelpScreen .section-title {
        text-style: bold;
        color: $secondary;
        padding-bottom: 1;
    }

    HelpScreen .shortcut-key {
        color: $success;
        text-style: bold;
    }

    HelpScreen .shortcut-desc {
        color: $text;
    }

    HelpScreen .hint {
        color: $text-muted;
        padding-top: 2;
    }
    """

    def compose(self) -> ComposeResult:
        with Container():
            yield Static("╔══════════ Cellrix Help ══════════╗", classes="title")
            yield Static("")
            
            with Horizontal():
                with Container():
                    yield Static("Global Shortcuts", classes="section-title")
                    yield Static(" q / Esc          Quit")
                    yield Static(" Tab / Shift+Tab  Focus next / prev")
                    yield Static(" F1               Show this help")
                    yield Static(" g                Leader key (a-z to jump)")
                    yield Static(" ↑↓ PgUp PgDn     Scroll focused panel")
                    yield Static(" Alt+1..9         Direct panel jump")
                
                with Container():
                    yield Static("Panel Shortcuts", classes="section-title")
                    yield Static(" (none)")

            yield Static("")
            yield Static("Press Escape or F1 to close.", classes="hint")


# ─────────────────────────── Main Application ──────────────────────────────
class TextualCellrixApp(App):
    """A Textual application that boots from a Cell-Manifest."""

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
        emit_events: bool = True,
    ) -> None:
        self.manifest_path = Path(manifest_path)
        self.strict = strict
        self.emit_events = emit_events
        self.manifest: Optional[CellManifest] = None
        super().__init__()

    def compose(self) -> ComposeResult:
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
            yield self._create_cell_widget(cell)
            return

        yield self._build_layout(self.manifest)

    def _create_cell_widget(self, cell: Cell):
        """Return an appropriate Textual widget for a single Cell."""
        # Semantic widget rendering (v2.3)
        if cell.semantic_widget and cell.semantic_data is not None:
            try:
                if cell.semantic_widget == "progress":
                    if isinstance(cell.semantic_data, bool):
                        raise ValueError("Boolean is not a valid progress value")
                    val = float(cell.semantic_data)
                    if val < 0:
                        val = 0
                    elif val > 100:
                        val = 100
                    progress = ProgressBar(total=100, show_eta=False)
                    progress.advance(val)
                    progress.add_class("cell")
                    progress.can_focus = True
                    return progress

                elif cell.semantic_widget == "table":
                    if isinstance(cell.semantic_data, list) and all(
                        isinstance(row, list) for row in cell.semantic_data
                    ):
                        table = DataTable()
                        table.add_class("cell")
                        table.can_focus = True
                        if cell.semantic_data and all(isinstance(c, str) for c in cell.semantic_data[0]):
                            table.add_columns(*cell.semantic_data[0])
                            for row in cell.semantic_data[1:]:
                                padded = list(row) + [""] * (len(cell.semantic_data[0]) - len(row))
                                cells = [
                                    str(c) if isinstance(c, (str, int, float)) else ""
                                    for c in padded
                                ]
                                table.add_row(*cells)
                        else:
                            for row in cell.semantic_data:
                                padded = list(row)
                                cells = [
                                    str(c) if isinstance(c, (str, int, float)) else ""
                                    for c in padded
                                ]
                                if not table.columns:
                                    table.add_columns(*[f"C{i}" for i in range(len(cells))])
                                table.add_row(*cells)
                        return table
                    raise ValueError("Table data is not a valid 2D array")

                elif cell.semantic_widget == "list":
                    if isinstance(cell.semantic_data, list):
                        items = [
                            f"• {item}" if isinstance(item, str) else ""
                            for item in cell.semantic_data
                        ]
                        text = "\n".join(items)
                        w = Static(text, classes="cell")
                        w.can_focus = True
                        return w
                    raise ValueError("List data is not a valid array")

                # Unknown or unsupported widget falls through to plain text
            except (ValueError, TypeError):
                pass  # fall back to Static below

        # Default: plain text
        content = cell.content or cell.id
        w = Static(content, classes="cell")
        w.can_focus = True
        return w

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
                    children.append(self._create_cell_widget(cell))
                else:
                    w = Static("", classes="cell")
                    w.can_focus = True
                    children.append(w)

        if manifest.layout.direction == "horizontal":
            return Horizontal(*children)
        return Vertical(*children)

    # ── Event Emitters ──────────────────────────────────────────────────
    def _emit(self, action: str, cell_id: str | None = None, payload: dict | None = None) -> None:
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
