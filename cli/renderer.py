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
from .theme import Theme, DEFAULT_THEME
from .keybindings import Keybindings, DEFAULT_KEYBINDINGS

TRANS_BG = Style(bgcolor="default")
WHITE_TEXT = Style(color="white", bgcolor="default")
FOCUSED_TITLE_STYLE = Style(color="green", bold=True, bgcolor="default")


@dataclass
class UIState:
    full_help: bool = False
    focus_index: int = 0
    last_width: int = 0
    last_height: int = 0


class CellrixRenderer:
    """Renders a ViewTree with Rich, driven by Theme and Keybindings."""

    def __init__(
        self,
        manifest: CellManifest,
        strict: bool = False,
        theme: Theme = DEFAULT_THEME,
        keybindings: Keybindings = DEFAULT_KEYBINDINGS,
    ) -> None:
        self.manifest = manifest
        self.strict = strict
        self.theme = theme
        self.keybindings = keybindings
        self.state = UIState()
        self._flat_nodes: List[Node] = []
        self._cached_view_tree: Optional[ViewTree] = None
        self.dynamic_content: Dict[str, str] = {}

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

    def __rich_console__(
        self, console: Console, options: ConsoleOptions
    ) -> RenderResult:
        term_w = console.width
        term_h = console.height

        available_h = term_h if self.state.full_help else term_h - 1

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

        if self.state.full_help:
            help_overlay = self._build_full_help_panel(term_w, term_h)
            outer = Layout(help_overlay, size=term_h)
        else:
            status_panel = self._build_status_bar()
            outer = Layout()
            outer.split_column(
                Layout(main_layout, ratio=1),
                Layout(status_panel, size=1),
            )

        yield outer

    def _build_node(self, node: Node) -> Layout:
        if not node.children:
            cell = self._get_cell_by_id(node.id)
            display_text = node.content or node.id
            if cell and cell.type in (CellType.DYNAMIC, CellType.REALTIME):
                display_text = self.dynamic_content.get(node.id, display_text)

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
                f" {node.id} ",
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

    def _build_status_bar(self) -> Panel:
        left = "[F1] Help"
        right = "[Q] Quit  [Tab] Focus Next"

        if self._flat_nodes and self.state.focus_index < len(self._flat_nodes):
            focused_id = self._flat_nodes[self.state.focus_index].id
            cell = self._get_cell_by_id(focused_id)
            if cell and cell.actions and cell.actions.on_key:
                extras = " | ".join(
                    f"[{a.get('key', '?').upper()}] {a.get('emit', 'action')}"
                    for a in cell.actions.on_key[:2]
                )
                right = extras + "   " + right

        return Panel(
            Text(f"{left:<20}{right:>60}", style=WHITE_TEXT),
            box=box.SIMPLE,
            border_style=self.theme.status_border_style,
            style=TRANS_BG,
        )

    def _build_full_help_panel(self, width: int, height: int) -> Panel:
        lines: List[str] = [
            "═" * (width - 4),
            "  CELLRIX HELP  (Press F1 or Esc to close)",
            "═" * (width - 4),
            "",
            "Global shortcuts:",
        ]

        for key, action in self.keybindings.global_bindings.items():
            lines.append(f"  {key:<12} → {action}")

        lines.append("")
        lines.append("Context shortcuts (current panel):")

        if self._flat_nodes and self.state.focus_index < len(self._flat_nodes):
            focused_id = self._flat_nodes[self.state.focus_index].id
            cell = self._get_cell_by_id(focused_id)
            if cell and cell.actions and cell.actions.on_key:
                for action_dict in cell.actions.on_key:
                    key = action_dict.get("key", "?")
                    emit = action_dict.get("emit", "action")
                    lines.append(f"  {key.upper():<12} → {emit}")
            else:
                lines.append("  (no actions defined for this panel)")
        else:
            lines.append("  (no panel focused)")

        while len(lines) < height - 2:
            lines.append("")

        title = Text("Help", style=WHITE_TEXT)
        return Panel(
            Text("\n".join(lines), style=WHITE_TEXT),
            title=title,
            border_style=self.theme.help_border_style,
            box=box.HEAVY,
            style=TRANS_BG,
        )

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
                return [
                    (a.get("key", "?"), a.get("emit", "action"))
                    for a in cell.actions.on_key
                ]
        return None
