"""Renderer module for Cellrix.

Consumes a CellManifest and a UIState, produces a Rich Layout tree.
Contains no event loops or input handling — pure view logic.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from rich.console import Console, ConsoleOptions, RenderResult
from rich.layout import Layout
from rich.panel import Panel
from rich.text import Text
from rich.style import Style
from rich import box

from core.layout.solver import solve
from core.manifest.models import Cell, CellManifest, CellType
from core.tree import Node, ViewTree
from core.source import SourceManager
from .theme import Theme, DEFAULT_THEME
from .keybindings import Keybindings, DEFAULT_KEYBINDINGS

TRANS_BG = Style(bgcolor="default")
WHITE_TEXT = Style(color="white", bgcolor="default")
FOCUSED_TITLE_STYLE = Style(color="green", bold=True, bgcolor="default")

# Map semantic style keywords to Rich colors (v2.3 visual enhancement)
_STYLE_COLOR_MAP: dict[str, str] = {
    "primary": "bright_blue",
    "secondary": "grey70",
    "success": "green",
    "danger": "red",
    "warning": "yellow",
    "info": "cyan",
}


@dataclass
class UIState:
    full_help: bool = False
    show_shortcuts: bool = False       # toggled by '?'
    focus_index: int = 0
    last_width: int = 0
    last_height: int = 0
    scroll_offsets: Dict[str, int] = field(default_factory=dict)
    leader_active: bool = False        # True while waiting for leader letter


class CellrixRenderer:
    """Renders a ViewTree with Rich, driven by Theme and Keybindings."""

    def __init__(
        self,
        manifest: CellManifest,
        strict: bool = False,
        theme: Theme = DEFAULT_THEME,
        keybindings: Keybindings = DEFAULT_KEYBINDINGS,
        source_manager: Optional[SourceManager] = None,
    ) -> None:
        self.manifest = manifest
        self.strict = strict
        self.theme = theme
        self.keybindings = keybindings
        self.state = UIState()
        self._flat_nodes: List[Node] = []
        self._cached_view_tree: Optional[ViewTree] = None
        self.dynamic_content: Dict[str, str] = {}
        self.source_manager = source_manager

    def update_manifest(self, new_manifest: CellManifest) -> None:
        """Replace the current manifest and clear the cached layout."""
        self.manifest = new_manifest
        self._cached_view_tree = None

    def update_dynamic_content(self, updates: Dict[str, str]) -> None:
        """Merge incoming dynamic updates into the renderer state."""
        self.dynamic_content.update(updates)

    def _get_sorted_leaf_nodes(self, root: Node) -> List[Node]:
        leaves: List[Node] = []

        def traverse(node: Node) -> None:
            if not node.children:
                leaves.append(node)
            else:
                for child in node.children:
                    traverse(child)

        traverse(root)
        leaves.sort(key=lambda n: (n.y, n.x))
        return leaves

    def get_focused_cell(self) -> Optional[Cell]:
        if not self._flat_nodes or self.state.focus_index >= len(self._flat_nodes):
            return None
        focused_id = self._flat_nodes[self.state.focus_index].id
        return self._get_cell_by_id(focused_id)

    # ------------------------------------------------------------------
    # Rich protocol
    # ------------------------------------------------------------------
    def __rich_console__(
        self, console: Console, options: ConsoleOptions
    ) -> RenderResult:
        # Dynamic data auto‑poll
        if self.source_manager is not None:
            updates = self.source_manager.poll_all()
            if updates:
                self.dynamic_content.update(updates)

        term_w = console.width
        term_h = console.height

        available_h = term_h if (self.state.full_help or self.state.show_shortcuts) else term_h - 1

        if (
            self._cached_view_tree is None
            or term_w != self.state.last_width
            or term_h != self.state.last_height
        ):
            try:
                self._cached_view_tree = solve(self.manifest, term_w, available_h)
                self.state.last_width = term_w
                self.state.last_height = term_h
            except Exception as e:
                yield Text(f"Layout Error: {e}", style="bold red")
                return

        root = self._cached_view_tree.nodes[0]
        self._flat_nodes = self._get_sorted_leaf_nodes(root)

        main_layout = self._build_node(root)

        if self.state.show_shortcuts or self.state.full_help:
            overlay = self._build_shortcut_overlay(term_w, term_h)
            outer = Layout(overlay, size=term_h)
        else:
            status_panel = self._build_status_bar()
            outer = Layout()
            outer.split_column(
                Layout(main_layout, ratio=1),
                Layout(status_panel, size=1),
            )

        yield outer

    # ------------------------------------------------------------------
    # Layout construction
    # ------------------------------------------------------------------
    def _build_node(self, node: Node) -> Layout:
        if not node.children:
            cell = self._get_cell_by_id(node.id)
            display_text = node.content or node.id
            if cell and cell.type in (CellType.DYNAMIC, CellType.REALTIME):
                display_text = self.dynamic_content.get(node.id, display_text)

            # ---------- Structured data rendering (v2.3) ----------
            if cell:
                display_text = self._build_semantic_content(cell, display_text)

            # ---------- Scroll handling ----------
            if cell and cell.collapse_mode == "scroll" and node.height > 0:
                lines = display_text.splitlines()
                visible_lines = node.height
                offset = self.state.scroll_offsets.get(node.id, 0)
                max_offset = max(0, len(lines) - visible_lines)
                offset = max(0, min(offset, max_offset))
                self.state.scroll_offsets[node.id] = offset
                slice_end = offset + visible_lines
                displayed_lines = lines[offset:slice_end]
                if offset > 0:
                    displayed_lines.insert(0, "↑ (scroll up)")
                if offset + visible_lines < len(lines):
                    displayed_lines.append("↓ (scroll down)")
                display_text = "\n".join(displayed_lines)

            # ---------- Panel label ----------
            label = ""
            if self._flat_nodes and node in self._flat_nodes:
                idx = self._flat_nodes.index(node)
                if idx < 26:
                    letter = chr(ord('a') + idx)
                    if self.state.leader_active:
                        label = f"[{letter}] "
                    else:
                        label = f"[{idx+1}] "

            title_text = f" {label}{node.id} " if label else f" {node.id} "

            if node.width < 3 or node.height < 3:
                txt = Text(display_text[: node.width], overflow="ellipsis", style=WHITE_TEXT)
                return Layout(txt, name=node.id)

            is_focused = (
                self._flat_nodes
                and self.state.focus_index < len(self._flat_nodes)
                and node.id == self._flat_nodes[self.state.focus_index].id
            )
            border = (
                self.theme.focused_border_style
                if is_focused
                else self.theme.border_style
            )

            title = Text(
                title_text,
                style=FOCUSED_TITLE_STYLE if is_focused else WHITE_TEXT,
            )

            panel = Panel(
                Text(display_text, style=WHITE_TEXT, overflow="ellipsis"),
                title=title,
                border_style=border,
                title_align="left",
                style=TRANS_BG,
            )
            return Layout(panel, name=node.id)

        # Container node
        child_layouts = [self._build_node(child) for child in node.children]

        is_horizontal = False
        if len(node.children) >= 2:
            is_horizontal = (
                node.children[0].y == node.children[1].y
                and node.children[0].x != node.children[1].x
            )

        container = Layout(name=node.id)

        if is_horizontal:
            container.split_row(
                *[
                    Layout(child.renderable, size=child_node.width, name=child_node.id)
                    for child, child_node in zip(child_layouts, node.children)
                ]
            )
        else:
            container.split_column(
                *[
                    Layout(child.renderable, size=child_node.height, name=child_node.id)
                    for child, child_node in zip(child_layouts, node.children)
                ]
            )

        return container

    # ------------------------------------------------------------------
    # Semantic data rendering (v2.3)
    # ------------------------------------------------------------------
    def _build_semantic_content(self, cell: Cell, fallback: str) -> str:
        """Render semantic_data according to semantic_widget, or return fallback.

        Strictly follows White Paper v2.3 downgrade rules:
        - progress: clamp 0‑100, format as bar; non‑numeric / bool → fallback
        - list: array of strings → bulleted; non‑array → fallback
        - table: 2‑D array → pipe‑separated; jagged/invalid → fallback
        - unknown widget → fallback
        All output strings are sanitised to remove ANSI escape sequences.
        """
        if not cell.semantic_widget or cell.semantic_data is None:
            return fallback

        try:
            if cell.semantic_widget == "progress":
                # Explicitly reject boolean values
                if isinstance(cell.semantic_data, bool):
                    return fallback
                val = float(cell.semantic_data)
                if val < 0:
                    val = 0
                elif val > 100:
                    val = 100
                filled = int(val / 100 * 20)
                bar = "█" * filled + "░" * (20 - filled)
                return self._strip_ansi(f"{bar} {val:.0f}%")

            elif cell.semantic_widget == "list":
                if isinstance(cell.semantic_data, list):
                    items = [
                        f"• {item}" if isinstance(item, str) else ""
                        for item in cell.semantic_data
                    ]
                    return self._strip_ansi("\n".join(items))
                return fallback

            elif cell.semantic_widget == "table":
                if isinstance(cell.semantic_data, list) and all(
                    isinstance(row, list) for row in cell.semantic_data
                ):
                    # Determine max columns
                    max_cols = max(len(row) for row in cell.semantic_data) if cell.semantic_data else 0
                    table_text = []
                    for row in cell.semantic_data:
                        padded = list(row) + [""] * (max_cols - len(row))
                        cells = [
                            str(c) if isinstance(c, (str, int, float)) else ""
                            for c in padded
                        ]
                        table_text.append(" | ".join(cells))
                    return self._strip_ansi("\n".join(table_text))
                return fallback

            else:
                return fallback
        except (ValueError, TypeError):
            return fallback

    @staticmethod
    def _strip_ansi(text: str) -> str:
        """Remove ANSI escape sequences from a string (basic control codes)."""
        import re
        ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
        return ansi_escape.sub('', text)

    # ------------------------------------------------------------------
    # Bottom status bar (single line, Nano style) + visual styles (v2.3)
    # ------------------------------------------------------------------
    def _build_status_bar(self) -> Panel:
        left = "[F1] Help  [?] Shortcuts"
        right = "[Q] Quit  [Tab] Focus Next  [g] Leader"

        if self._flat_nodes and self.state.focus_index < len(self._flat_nodes):
            focused_id = self._flat_nodes[self.state.focus_index].id
            cell = self._get_cell_by_id(focused_id)
            if cell and cell.actions and cell.actions.on_key:
                extras_parts = []
                for a in cell.actions.on_key[:2]:
                    key_display = (a.key or "?").upper()
                    label = a.intent or "action"
                    # Determine text color based on semantic style
                    color = _STYLE_COLOR_MAP.get(a.style, "white") if a.style else "white"
                    extras_parts.append(f"[{color}][{key_display}] {label}[/{color}]")
                extras = " | ".join(extras_parts)
                right = extras + "   " + right

        return Panel(
            Text(f"{left:<20}{right:>60}", style=WHITE_TEXT),
            box=box.SIMPLE,
            border_style=self.theme.status_border_style,
            style=TRANS_BG,
        )

    # ------------------------------------------------------------------
    # Full‑screen help overlay (F1)
    # ------------------------------------------------------------------
    def _build_full_help_panel(self, width: int, height: int) -> Panel:
        return self._build_shortcut_overlay(width, height)

    def _build_shortcut_overlay(self, width: int, height: int) -> Panel:
        """Build an overlay panel showing all available shortcuts."""
        lines = ["═══ AVAILABLE SHORTCUTS (Press ? or F1 to close) ═══", ""]
        lines.append("Global:")
        lines.append("  q / Esc          Quit")
        lines.append("  Tab / Shift+Tab  Focus next/prev")
        lines.append("  F1               Help")
        lines.append("  ?                Shortcut reference")
        lines.append("  g                Leader key (then a-z to jump)")
        lines.append("  ↑↓ PgUp PgDn     Scroll focused panel")
        lines.append("  Alt+1..9         Direct panel jump")
        lines.append("")
        lines.append("Panel‑specific:")
        cell = self.get_focused_cell()
        if cell and cell.actions and cell.actions.on_key:
            for action in cell.actions.on_key:
                lines.append(f"  {(action.key or '?')}  →  {action.intent or 'action'}")
        else:
            lines.append("  (none)")

        while len(lines) < height - 2:
            lines.append("")

        return Panel(
            Text("\n".join(lines), style=WHITE_TEXT),
            title="Shortcuts",
            border_style=self.theme.help_border_style,
            box=box.HEAVY,
            style=TRANS_BG,
        )

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _get_cell_by_id(self, cell_id: str) -> Optional[Cell]:
        for cell in self.manifest.cells:
            if cell.id == cell_id:
                return cell
        return None

    def _get_focused_manifest_actions(self) -> Optional[List[Tuple[str, str]]]:
        if not self._flat_nodes or self.state.focus_index >= len(self._flat_nodes):
            return None
        focused_id = self._flat_nodes[self.state.focus_index].id
        for cell in self.manifest.cells:
            if cell.id == focused_id and cell.actions and cell.actions.on_key:
                return [(a.key or "?", a.intent or "action") for a in cell.actions.on_key]
        return None
