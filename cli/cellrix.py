"""Cellrix CLI entry point. Use `cellrix preview <manifest>` to see live layouts."""

import time
from pathlib import Path

import click
from rich.console import Console, ConsoleOptions, RenderResult
from rich.layout import Layout
from rich.live import Live
from rich.panel import Panel
from rich.text import Text

from core.layout.solver import solve
from core.manifest.parser import parse_manifest
from core.tree import Node


class CellrixRenderer:
    """Renders a ViewTree through Rich with absolute sizing — no re-layout."""

    def __init__(self, manifest, strict: bool = False):
        self.manifest = manifest
        self.strict = strict

    def __rich_console__(
        self, console: Console, options: ConsoleOptions
    ) -> RenderResult:
        term_w = console.width
        term_h = console.height

        try:
            view_tree = solve(self.manifest, term_w, term_h)
        except Exception as e:
            yield Text(f"Layout Error: {e}", style="bold red")
            return

        root = view_tree.nodes[0]
        yield self._build_node(root)

    def _build_node(self, node: Node) -> Layout:
        # Leaf node: produce content
        if not node.children:
            display_text = node.content if node.content else node.id
            # Border collapse protection: too cramped for Panel
            if node.width < 3 or node.height < 3:
                content = Text(
                    display_text if len(display_text) <= node.width else "…",
                    overflow="ellipsis",
                )
                return Layout(content, name=node.id)

            panel = Panel(
                Text(display_text, overflow="ellipsis"),
                title=node.id,
                border_style="blue",
            )
            return Layout(panel, name=node.id)

        # Container: determine split direction from first two children
        is_horizontal = False
        if len(node.children) >= 2:
            is_horizontal = (
                node.children[0].y == node.children[1].y
                and node.children[0].x != node.children[1].x
            )

        layout = Layout(name=node.id)

        if is_horizontal:
            children_layouts = [
                Layout(
                    self._build_node(child),
                    size=child.width,
                    name=child.id,
                )
                for child in node.children
            ]
            layout.split_row(*children_layouts)
        else:
            children_layouts = [
                Layout(
                    self._build_node(child),
                    size=child.height,
                    name=child.id,
                )
                for child in node.children
            ]
            layout.split_column(*children_layouts)

        return layout


@click.group()
def cli() -> None:
    """Cellrix CLI - intent-driven terminal interface toolkit."""


@cli.command()
@click.argument("manifest_path", type=click.Path(exists=True))
@click.option("--strict", is_flag=True, help="Enable strict schema validation")
def preview(manifest_path: str, strict: bool) -> None:
    """Live preview of a Cell-Manifest layout."""
    manifest_file = Path(manifest_path)
    try:
        manifest = parse_manifest(manifest_file, strict=strict)
    except Exception as e:
        click.echo(f"Error parsing manifest: {e}", err=True)
        raise SystemExit(1)

    renderer = CellrixRenderer(manifest, strict=strict)

    with Live(renderer, screen=True, refresh_per_second=10):
        try:
            while True:
                time.sleep(0.1)
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    cli()
