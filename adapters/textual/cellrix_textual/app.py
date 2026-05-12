"""TextualCellrixApp — a Textual App that reads a Cell-Manifest and renders it,
and emits Cellrix Action JSON on user interactions."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Dict, List, Optional

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical, Container
from textual.screen import ModalScreen
from textual.widgets import Static, ProgressBar, DataTable

from core.manifest.parser import parse_manifest
from core.manifest.models import CellManifest, Cell, Layout


class HelpScreen(ModalScreen):
    BINDINGS = [
        Binding("escape", "dismiss", "Close Help"),
        Binding("f1", "dismiss", "Close Help"),
    ]

    DEFAULT_CSS = """
    HelpScreen > Container {
        width: 80%;
        height: 80%;
        background: $surface;
        border: thick $accent;
        padding: 1 2;
    }
    """

    def compose(self) -> ComposeResult:
        with Container():
            yield Static("Cellrix Help", classes="title")
            yield Static("\nGlobal Shortcuts:")
            yield Static(" q / Esc          Quit")
            yield Static(" Tab / Shift+Tab  Focus next / prev")
            yield Static(" F1               Show this help")
            yield Static("\nPress Escape or F1 to close.", classes="hint")


class TextualCellrixApp(App):
    CSS = """
    Screen { align: center top; }
    
    /* 修复 1：废除全局 100%，所有布局节点公平分配 1fr 空间 */
    .layout-node { 
        width: 1fr; 
        height: 1fr; 
        min-width: 0; 
        min-height: 0; 
    }
    
    /* 修复 2：提高 min-width 到 12，彻底打破滚动条闪烁悖论 */
    .cell-wrapper { 
        border: solid $panel; 
        padding: 0 1; 
        width: 1fr; 
        height: 1fr; 
        min-width: 12; 
        min-height: 3;
        overflow: hidden auto; 
    }
    
    .cell-wrapper:focus-within { 
        border: solid $success; 
    }
    """

    BINDINGS =[
        Binding("q", "emit_quit", "Quit"),
        Binding("tab", "emit_focus_next", "Next Panel", show=False),
        Binding("shift+tab", "emit_focus_prev", "Prev Panel", show=False),
        Binding("f1", "emit_toggle_help", "Help"),
    ]

    def __init__(self, manifest_path: str | Path, strict: bool = False, emit_events: bool = True) -> None:
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

        self._cells_by_slot: Dict[str, List[Cell]] = {}
        for cell in self.manifest.cells:
            self._cells_by_slot.setdefault(cell.slot,[]).append(cell)

        if len(self.manifest.cells) == 1 and not any(s.layout for s in self.manifest.layout.slots):
            yield self._create_cell_widget(self.manifest.cells[0])
            return

        yield self._build_layout(self.manifest.layout)

    def _create_cell_widget(self, cell: Cell):
        inner_w = None
        if cell.semantic_widget and cell.semantic_data is not None:
            try:
                if cell.semantic_widget == "progress":
                    if isinstance(cell.semantic_data, bool): raise ValueError
                    val = max(0, min(float(cell.semantic_data), 100))
                    inner_w = ProgressBar(total=100, show_eta=False)
                    inner_w.advance(val)
                elif cell.semantic_widget == "table":
                    if isinstance(cell.semantic_data, list) and all(isinstance(r, list) for r in cell.semantic_data):
                        inner_w = DataTable()
                        inner_w.cursor_type = "row"
                        if cell.semantic_data and all(isinstance(c, str) for c in cell.semantic_data[0]):
                            inner_w.add_columns(*cell.semantic_data[0])
                            for row in cell.semantic_data[1:]:
                                padded = row + [""] * (len(cell.semantic_data[0]) - len(row))
                                inner_w.add_row(*[str(c) if isinstance(c, (str, int, float)) else "" for c in padded])
                        else:
                            for row in cell.semantic_data:
                                if not inner_w.columns:
                                    inner_w.add_columns(*[f"C{i}" for i in range(len(row))])
                                inner_w.add_row(*[str(c) if isinstance(c, (str, int, float)) else "" for c in row])
                elif cell.semantic_widget == "list":
                    if isinstance(cell.semantic_data, list):
                        text = "\n".join(f"• {item}" if isinstance(item, str) else "" for item in cell.semantic_data)
                        inner_w = Static(text)
            except (ValueError, TypeError): pass

        if inner_w is None:
            inner_w = Static(str(cell.content or cell.id))
        
        inner_w.can_focus = True

        wrapper = Vertical(inner_w, classes="cell-wrapper")
        wrapper.border_title = cell.id
        return wrapper

    def _build_layout(self, layout: Layout):
        children =[]
        for slot in layout.slots:
            if slot.layout is not None:
                child = self._build_layout(slot.layout)
            else:
                cell = (self._cells_by_slot.get(slot.id, [None]) or [None])[0]
                if cell: 
                    child = self._create_cell_widget(cell)
                else: 
                    child = Vertical(classes="cell-wrapper")
            
            # 修复 3：动态读取 Manifest 中的 size 属性，尊重你的布局设计！
            size = getattr(slot, "size", None)
            if size is not None:
                dim = size if isinstance(size, int) else str(size)
                if layout.direction == "horizontal":
                    child.styles.width = dim
                else:
                    child.styles.height = dim

            children.append(child)
            
        container = Horizontal(*children) if layout.direction == "horizontal" else Vertical(*children)
        container.add_class("layout-node")
        return container

    def _emit(self, action: str, cell_id: str | None = None, payload: dict | None = None) -> None:
        if not self.emit_events: return
        print(json.dumps({"event":"cellrix.action","action":action,"cell_id":cell_id or "","payload":payload or {}}), file=sys.stderr, flush=True)

    def action_emit_focus_next(self): self.focus_next()
    def action_emit_focus_prev(self): self.focus_previous()
    def action_emit_toggle_help(self): self.push_screen(HelpScreen())
    def action_emit_quit(self): self.exit()


if __name__ == "__main__":
    if len(sys.argv) < 2: print("Usage: python app.py <manifest.json>", file=sys.stderr); sys.exit(1)
    app = TextualCellrixApp(sys.argv[1])
    app.run()
