"""Cellrix CLI entry point. Use `cellrix preview <manifest>` to see live layouts."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple

import click
import readchar
from rich.console import Console, ConsoleOptions, RenderResult
from rich.layout import Layout
from rich.live import Live
from rich.panel import Panel
from rich.text import Text
from rich.style import Style
from rich import box

from core.layout.solver import solve
from core.manifest.parser import parse_manifest
from core.manifest.models import Cell, CellManifest
from core.tree import Node, ViewTree
from cli.theme import Theme, DEFAULT_THEME
from cli.keybindings import (
    Keybindings,
    DEFAULT_KEYBINDINGS,
    QUIT,
    FOCUS_NEXT,
    FOCUS_PREV,
    TOGGLE_HELP,
)

TRANS_BG = Style(bgcolor="default")
WHITE_TEXT = Style(color="white", bgcolor="default")
FOCUSED_TITLE_STYLE = Style(color="green", bold=True, bgcolor="default")


def _normalize_key(raw: str) -> str:
    if raw in ('\x1bOP', '\x1b[11~', '\x1bOQ'):
        return 'f1'
    if raw == '\x1b[Z':
        return 'shift+tab'
    if raw == '\x1b[H':
        return 'home'
    if raw == '\x1b[F':
        return 'end'
    if raw == '\x1b':
        return 'escape'
    if raw == '\t':
        return 'tab'
    if raw in ('\r', '\n'):
        return 'enter'
    if raw == '\x7f':
        return 'backspace'
    if len(raw) == 1 and raw.isprintable():
        return raw.lower()
    return raw


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
            display_text = node.content or node.id

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


@click.group()
def cli() -> None:
    """Cellrix CLI - intent-driven terminal interface toolkit."""


@cli.command()
@click.argument("manifest_path", type=click.Path(exists=True))
@click.option("--strict", is_flag=True, help="Enable strict schema validation")
def preview(manifest_path: str, strict: bool) -> None:
    manifest_file = Path(manifest_path)
    try:
        manifest = parse_manifest(manifest_file, strict=strict)
    except Exception as e:
        click.echo(f"Error parsing manifest: {e}", err=True)
        raise SystemExit(1)

    renderer = CellrixRenderer(manifest, strict=strict)

    with Live(renderer, screen=True, refresh_per_second=10) as live:
        try:
            while True:
                raw = readchar.readkey()
                if not raw:
                    continue

                key = _normalize_key(raw)
                manifest_actions = renderer._get_focused_manifest_actions()
                action = renderer.keybindings.resolve(key, manifest_actions)

                if action == QUIT:
                    break
                elif action == FOCUS_NEXT:
                    if renderer._flat_nodes:
                        renderer.state.focus_index = (
                            renderer.state.focus_index + 1
                        ) % len(renderer._flat_nodes)
                elif action == FOCUS_PREV:
                    if renderer._flat_nodes:
                        renderer.state.focus_index = (
                            renderer.state.focus_index - 1
                        ) % len(renderer._flat_nodes)
                elif action == TOGGLE_HELP:
                    renderer.state.full_help = not renderer.state.full_help

                live.update(renderer)

        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    cli()
