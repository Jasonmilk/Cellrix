"""
Cellrix Daemon command.

Starts a background HTTP/WebSocket server exposing the Agent API.
All configuration is injected via environment variables (0 hardcoded values).
"""

from __future__ import annotations

import os

import click

# Imported only when the command is invoked to avoid mandatory dependency.
# FastAPI and uvicorn are declared in [project.optional-dependencies] 'server'.
try:
    import uvicorn
except ImportError as exc:
    raise ImportError(
        "Missing optional 'server' dependencies. "
        "Install with: pip install cellrix[server]"
    ) from exc

from cli.daemon.agent_routes import create_app


DEFAULT_HOST: str = "127.0.0.1"
DEFAULT_PORT: str = "8765"


@click.command(name="daemon")
@click.option(
    "--host",
    default=None,
    help="Bind address (env: CELLRIX_DAEMON_HOST, default: 127.0.0.1)",
)
@click.option(
    "--port",
    default=None,
    type=int,
    help="Bind port (env: CELLRIX_DAEMON_PORT, default: 8765)",
)
def daemon_command(host: str | None, port: int | None) -> None:
    """Launch the Cellrix Agent API daemon (long-running process)."""
    resolved_host: str = host or os.getenv("CELLRIX_DAEMON_HOST", DEFAULT_HOST)
    resolved_port: int = port or int(
        os.getenv("CELLRIX_DAEMON_PORT", str(DEFAULT_PORT))
    )

    app = create_app()  # Build FastAPI app with lifespan and routes.

    uvicorn.run(
        app,
        host=resolved_host,
        port=resolved_port,
        log_level="info",
    )
