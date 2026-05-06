"""Cellrix CLI entry point. Use `cellrix preview <manifest>` to see live layouts,
or `cellrix stream` to read Manifest JSON from stdin in real time."""

from __future__ import annotations

import sys
import time
from pathlib import Path
from typing import Optional

import click
import readchar
from rich.live import Live

from core.manifest.parser import parse_manifest
from core.source import SourceManager
from .runtime import CellrixRuntime, _normalize_key
from .renderer import CellrixRenderer
from .theme import DEFAULT_THEME
from .keybindings import (
    DEFAULT_KEYBINDINGS,
    QUIT,
    FOCUS_NEXT,
    FOCUS_PREV,
    TOGGLE_HELP,
)


@click.group()
def cli() -> None:
    """Cellrix CLI - intent-driven terminal interface toolkit."""


@cli.command()
@click.argument("manifest_path", type=click.Path(exists=True))
@click.option("--strict", is_flag=True, help="Enable strict schema validation")
@click.option(
    "--trust", is_flag=True, help="Allow execution of pipe sources (dangerous)"
)
def preview(manifest_path: str, strict: bool, trust: bool) -> None:
    """Live preview of a Cell-Manifest layout."""
    manifest_file = Path(manifest_path)
    try:
        manifest = parse_manifest(manifest_file, strict=strict)
    except Exception as e:
        click.echo(f"Error parsing manifest: {e}", err=True)
        raise SystemExit(1)

    source_manager: Optional[SourceManager] = None
    if trust:
        source_manager = SourceManager()
        for cell in manifest.cells:
            if cell.source is not None and cell.source.type == "pipe":
                source_manager.add_cell(cell)
    else:
        for cell in manifest.cells:
            if cell.source is not None and cell.source.type == "pipe":
                cell.content = (
                    "[Security Locked] Pipe execution disabled. Use --trust to enable."
                )
                cell.source = None

    runtime = CellrixRuntime(
        manifest,
        theme=DEFAULT_THEME,
        keybindings=DEFAULT_KEYBINDINGS,
        source_manager=source_manager,
    )
    runtime.run()


@cli.command()
@click.option("--strict", is_flag=True, help="Enable strict schema validation")
def stream(strict: bool) -> None:
    """Read a stream of Manifest JSON lines from stdin and render in real time.

    After the input stream ends, the display remains interactive so you can
    inspect the final state. Press 'q' to quit.
    """
    first_line = sys.stdin.readline()
    if not first_line:
        click.echo("No input received on stdin.", err=True)
        return

    try:
        initial_manifest = parse_manifest(first_line.strip(), strict=strict)
    except Exception as e:
        click.echo(f"Error parsing initial manifest: {e}", err=True)
        raise SystemExit(1)

    renderer = CellrixRenderer(initial_manifest)

    with Live(renderer, screen=True, refresh_per_second=10) as live:
        # Phase 1: consume stream lines
        try:
            while True:
                line = sys.stdin.readline()
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    new_manifest = parse_manifest(line, strict=strict)
                    renderer.update_manifest(new_manifest)
                except Exception as e:
                    click.echo(f"Error parsing manifest: {e}", err=True)
        except KeyboardInterrupt:
            return

        # Phase 2: interactive mode via /dev/tty
        try:
            tty = open("/dev/tty", "r")
            orig_stdin = sys.stdin
            sys.stdin = tty
            try:
                while True:
                    raw = readchar.readkey()
                    if not raw:
                        continue
                    key = _normalize_key(raw)
                    manifest_actions = renderer._get_focused_manifest_actions()
                    action = renderer.keybindings.resolve(
                        key, manifest_actions
                    )

                    if action == QUIT or key == "q":
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
            finally:
                sys.stdin = orig_stdin
                tty.close()
        except (FileNotFoundError, OSError):
            time.sleep(1.5)


if __name__ == "__main__":
    cli()
