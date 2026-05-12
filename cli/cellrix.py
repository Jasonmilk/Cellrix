"""Cellrix CLI entry point. Use `cellrix preview <manifest>` to see live layouts,
or `cellrix stream` to read Manifest JSON from stdin in real time,
or `cellrix run` to launch a bridge command with the Textual adapter,
or `cellrix check [manifest]` to validate a manifest file or bridge configuration."""

from __future__ import annotations

import json
import subprocess
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


@cli.command()
@click.argument("manifest_path", type=click.Path(exists=True), required=False)
@click.option(
    "--strict",
    is_flag=True,
    default=True,
    help="Enable strict schema validation (default: True)",
)
def check(manifest_path: Optional[str], strict: bool) -> None:
    """Validate a Cell-Manifest JSON file, or test a bridge configuration.

    If the file contains a 'bridge' field, the command will execute the
    bridge and validate its output as a Manifest.

    If MANIFEST_PATH is not provided, looks for 'cellrix_manifest.json'
    in the current directory.

    Exits with code 0 if validation succeeds, 1 otherwise.
    """
    if manifest_path is None:
        default_path = Path("cellrix_manifest.json")
        if not default_path.exists():
            click.echo(
                "Error: No manifest file specified and 'cellrix_manifest.json' "
                "not found in current directory.",
                err=True,
            )
            raise SystemExit(1)
        manifest_path = str(default_path)

    raw = Path(manifest_path).read_text(encoding="utf-8")

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        click.echo(f"❌ Invalid JSON: {e}", err=True)
        raise SystemExit(1)

    # --- Bridge configuration detection ---
    if "bridge" in data:
        bridge = data.get("bridge", {})
        bridge_type = bridge.get("type")

        if bridge_type == "cli_subprocess":
            command = bridge.get("command", [])
            if not command:
                click.echo("❌ Bridge config missing 'command' field.", err=True)
                raise SystemExit(1)

            click.echo(f"🔧 Executing bridge command: {' '.join(command)}")
            try:
                result = subprocess.run(
                    command,
                    capture_output=True,
                    text=True,
                    check=False,
                    timeout=10,
                )
            except subprocess.TimeoutExpired:
                click.echo("❌ Bridge command timed out.", err=True)
                raise SystemExit(1)
            except Exception as e:
                click.echo(f"❌ Failed to run bridge command: {e}", err=True)
                raise SystemExit(1)

            if result.returncode != 0:
                click.echo(
                    f"❌ Bridge command failed (exit code {result.returncode}).",
                    err=True,
                )
                if result.stderr:
                    click.echo(f"   stderr: {result.stderr.strip()}", err=True)
                raise SystemExit(1)

            # Validate the bridge output as a Manifest
            try:
                manifest_output = json.loads(result.stdout)
            except json.JSONDecodeError as e:
                click.echo(f"❌ Bridge output is not valid JSON: {e}", err=True)
                raise SystemExit(1)

            try:
                # parse_manifest expects a Path or a raw JSON string
                parse_manifest(json.dumps(manifest_output, ensure_ascii=False), strict=strict)
                click.echo("✅ Bridge executed successfully. Manifest is valid.")
            except Exception as e:
                click.echo(f"❌ Bridge output validation failed: {e}", err=True)
                raise SystemExit(1)
        else:
            click.echo(f"❌ Unsupported bridge type: '{bridge_type}'", err=True)
            raise SystemExit(1)
    else:
        # Standard manifest file validation
        try:
            parse_manifest(Path(manifest_path), strict=strict)
            click.echo("✅ Manifest is valid.")
        except Exception as e:
            click.echo(f"❌ Manifest validation failed: {e}", err=True)
            raise SystemExit(1)


if __name__ == "__main__":
    cli()
