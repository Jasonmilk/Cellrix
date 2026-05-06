"""Cellrix CLI entry point. Use `cellrix preview <manifest>` to test layouts."""

import shutil
import sys
from pathlib import Path

import click

from core.layout.solver import solve
from core.manifest.parser import parse_manifest


@click.group()
def cli() -> None:
    """Cellrix CLI - intent-driven terminal interface toolkit."""


@cli.command()
@click.argument("manifest_path", type=click.Path(exists=True))
@click.option("--strict", is_flag=True, help="Enable strict schema validation")
def preview(manifest_path: str, strict: bool) -> None:
    """Load a manifest, compute layout, and show an ANSI preview."""
    manifest_file = Path(manifest_path)
    try:
        manifest = parse_manifest(manifest_file, strict=strict)
    except Exception as e:
        click.echo(f"Error parsing manifest: {e}", err=True)
        sys.exit(1)

    term_width, term_height = shutil.get_terminal_size((80, 24))
    try:
        view = solve(manifest, term_width, term_height)
    except Exception as e:
        click.echo(f"Layout solver failed: {e}", err=True)
        sys.exit(1)

    # TODO: Render view to terminal via rich
    click.echo(f"Layout computed: {len(view.nodes)} nodes (rendering not yet implemented)")


if __name__ == "__main__":
    cli()
