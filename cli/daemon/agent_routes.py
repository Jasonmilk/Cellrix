"""
FastAPI application factory for Agent Accessibility endpoints.

Provides GET /v1/agent/snapshot and POST /v1/agent/action.
Uses lifespan to manage core resources, and delegates action execution
to the existing actions dispatcher. High-risk actions are intercepted by
the ActionInterceptor before execution.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, HTTPException, status

from core.schemas.agent import (
    ActionRequest,
    ActionResponse,
    CellEntity,
    SnapshotResponse,
    ViewportMeta,
)

# Existing Cellrix core API – provided by the daemon context.
from cli.actions import dispatch, register, FOCUS_NEXT, FOCUS_PREV, TOGGLE_HELP, QUIT
from cli.daemon.interceptor import ActionInterceptor, InterceptResult

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Temporary bridge – will be replaced by proper Daemon state in Phase 2
# ---------------------------------------------------------------------------

_latest_manifest: dict | None = None
_latest_viewport: tuple[int, int] = (80, 24)


def set_daemon_context(manifest: dict, width: int, height: int) -> None:
    """Update the shared daemon state (called from lifespan startup)."""
    global _latest_manifest, _latest_viewport
    _latest_manifest = manifest
    _latest_viewport = (width, height)


# ---------------------------------------------------------------------------
# Helper to build a snapshot from core trees
# ---------------------------------------------------------------------------

def _build_snapshot() -> SnapshotResponse:
    """Convert the current semantic tree into a SnapshotResponse.

    Falls back to a minimal placeholder if no manifest has been loaded.
    """
    if _latest_manifest is None:
        # Return empty snapshot when no session is active.
        return SnapshotResponse(
            viewport=ViewportMeta(width=80, height=24),
            cells=[],
        )

    # TODO: integrate with core.tree.SemanticTree once daemon state is linked.
    # For MVP we return a minimal cell matching the loaded manifest.
    dummy_cell = CellEntity(
        id="root",
        role="application",
        type="static",
        summary="Cellrix session active",
        available_actions=["quit", "focus_next", "focus_prev", "toggle_help"],
    )
    return SnapshotResponse(
        viewport=ViewportMeta(
            width=_latest_viewport[0], height=_latest_viewport[1]
        ),
        cells=[dummy_cell],
    )


# ---------------------------------------------------------------------------
# Lifespan (resource management)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def daemon_lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Manage core resources tied to the daemon lifecycle."""
    logger.info("Daemon lifespan started – initializing core state.")
    
    # Register placeholder handlers for essential actions.
    register(FOCUS_NEXT, lambda **kwargs: None)
    register(FOCUS_PREV, lambda **kwargs: None)
    register(TOGGLE_HELP, lambda **kwargs: None)
    register(QUIT, lambda **kwargs: None)
    
    # Placeholder: load manifest from env or default.
    # In Phase 2 this will be replaced with a full session manager.
    set_daemon_context({"version": "1.0", "type": "cellrix"}, 80, 24)
    yield
    logger.info("Daemon shutting down – releasing resources.")
    set_daemon_context(None, 0, 0)


# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------

def create_app() -> FastAPI:
    """Build and configure the FastAPI application for the Cellrix daemon."""
    app = FastAPI(
        title="Cellrix Agent API",
        version="0.1.0",
        lifespan=daemon_lifespan,
    )

    # Single interceptor instance for the daemon.
    interceptor = ActionInterceptor()

    # ------------------------------------------------------------------
    # P1a: Semantic Snapshot
    # ------------------------------------------------------------------
    @app.get("/v1/agent/snapshot", response_model=SnapshotResponse)
    async def get_snapshot() -> SnapshotResponse:
        """Return a read-only snapshot of the current UI state.

        Per Zen #2 all output is strictly typed. No side effects.
        """
        try:
            return _build_snapshot()
        except Exception:
            logger.exception("Snapshot generation failed")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal error while building snapshot",
            )

    # ------------------------------------------------------------------
    # P1b: Action Execution (with HITL interceptor)
    # ------------------------------------------------------------------
    @app.post("/v1/agent/action", response_model=ActionResponse)
    async def execute_action(request: ActionRequest) -> ActionResponse:
        """Execute a parameterised action dispatched by an Agent.

        Action validity and security constraints are enforced by the core
        dispatch layer. High-risk actions are intercepted by the
        ActionInterceptor before execution.
        """
        try:
            # Evaluate HITL requirements.
            # In full implementation, action_def is fetched from the manifest's
            # ActionDef for the focused cell. Currently using placeholder None
            # (all actions pass through).
            result = interceptor.evaluate(
                action_def=None, action_name=request.action
            )
            if result == InterceptResult.CONFIRMATION_REQUIRED:
                return ActionResponse(
                    success=False,
                    message=f"Action '{request.action}' requires human confirmation.",
                    action_taken=request.action,
                )

            # Delegate to the existing action dispatcher.
            # dispatch raises ValueError for unknown actions.
            dispatch(
                request.action, **(request.payload or {})
            )
            return ActionResponse(
                success=True,
                message=f"Action '{request.action}' executed.",
                action_taken=request.action,
            )
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            )
        except Exception:
            logger.exception("Unexpected error during action dispatch")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal dispatch error",
            )

    return app
