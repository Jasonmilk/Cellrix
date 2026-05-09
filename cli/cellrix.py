"""Cellrix CLI entry point. Use `cellrix preview <manifest>` to see live layouts,
or `cellrix stream` to read Manifest JSON from stdin in real time,
or `cellrix run` to launch a bridge command with the Textual adapter."""

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
from .runtime import CellrixRuntime
from .input_router import _normalize_key
from .renderer import CellrixRenderer
from .theme import DEFAULT_THEME
from .keybindings import (
    DEFAULT_KEYBINDINGS,
    QUIT,
    FOCUS_NEXT,
    FOCUS_PREV,
    TOGGLE_HELP,
)

# Attempt to import Textual runner (optional dependency)
try:
    from adapters.textual.cellrix_textual.runner import run_cellrix as _run_textual
    _HAS_TEXTUAL = True
except ImportError:
    _HAS_TEXTUAL = False


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


@cli.command(
    context_settings={"ignore_unknown_options": True, "allow_extra_args": True},
    help="Run a bridge command with the Textual adapter.",
)
@click.option("--strict", is_flag=True, help="Enable strict schema validation")
@click.argument("command", nargs=-1, required=True)
def run(strict: bool, command: tuple[str, ...]) -> None:
    """Run a Cellrix bridge command with the Textual adapter.

    This command launches the given subprocess, reads its Manifest output,
    renders a full‑screen Textual application, and writes user actions
    (in standard Cellrix Action JSON format) back to the subprocess.

    Example:

        cellrix run -- ana loom --cellrix

    The subprocess must output one line of JSON per update and must be
    able to read Action JSON lines from stdin.
    """
    if not _HAS_TEXTUAL:
        click.echo(
            "Textual adapter is not installed. Run: pip install cellrix[textual]",
            err=True,
        )
        raise SystemExit(1)

    # Convert the tuple to a list, removing the leading '--' if present
    cmd_list = list(command)
    if cmd_list and cmd_list[0] == "--":
        cmd_list = cmd_list[1:]

    if not cmd_list:
        click.echo("No command specified after --.", err=True)
        return

    _run_textual(cmd_list, strict=strict)


if __name__ == "__main__":
    cli()
