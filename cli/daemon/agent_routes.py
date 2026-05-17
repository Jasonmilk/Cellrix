"""
FastAPI application factory for Agent Accessibility endpoints.

Provides GET /v1/agent/snapshot, POST /v1/agent/action,
and event‑driven WebSocket /v1/ws/view.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncGenerator

from fastapi import FastAPI, HTTPException, status, WebSocket, WebSocketDisconnect

from core.schemas.agent import (
    ActionRequest,
    ActionResponse,
    CellEntity,
    SnapshotResponse,
    ViewportMeta,
)
from core.layout.solver import solve
from core.manifest.parser import parse_manifest

from cli.actions import dispatch, register, FOCUS_NEXT, FOCUS_PREV, TOGGLE_HELP, QUIT
from cli.daemon.interceptor import ActionInterceptor, InterceptResult

logger = logging.getLogger(__name__)

_latest_manifest: dict | None = None
_latest_viewport: tuple[int, int] = (80, 24)
_loaded_cell_manifest = None
_view_tree_cache: dict | None = None
_view_tree_event = asyncio.Event()  # signals that new ViewTree data is available


def _compute_and_cache_view_tree():
    """Recompute ViewTree from the loaded manifest and update the cache.
    Notifies all waiting WebSocket clients.
    """
    global _view_tree_cache
    if _loaded_cell_manifest is None:
        _view_tree_cache = None
    else:
        width = int(os.getenv("CELLRIX_TERM_WIDTH", "80"))
        height = int(os.getenv("CELLRIX_TERM_HEIGHT", "24"))
        view_tree = solve(_loaded_cell_manifest, terminal_width=width, terminal_height=height)
        _view_tree_cache = view_tree.to_dict()
    _view_tree_event.set()       # wake up WebSocket waiters
    _view_tree_event.clear()     # reset for next update


def set_daemon_context(manifest: dict, width: int, height: int) -> None:
    global _latest_manifest, _latest_viewport
    _latest_manifest = manifest
    _latest_viewport = (width, height)


def _build_snapshot() -> SnapshotResponse:
    if _latest_manifest is None:
        return SnapshotResponse(viewport=ViewportMeta(width=80, height=24), cells=[])
    dummy_cell = CellEntity(
        id="root",
        role="application",
        type="static",
        summary="Cellrix session active",
        available_actions=["quit", "focus_next", "focus_prev", "toggle_help"],
    )
    return SnapshotResponse(
        viewport=ViewportMeta(width=_latest_viewport[0], height=_latest_viewport[1]),
        cells=[dummy_cell],
    )


@asynccontextmanager
async def daemon_lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    global _loaded_cell_manifest
    logger.info("Daemon lifespan started – initializing core state.")
    register(FOCUS_NEXT, lambda **kwargs: None)
    register(FOCUS_PREV, lambda **kwargs: None)
    register(TOGGLE_HELP, lambda **kwargs: None)
    register(QUIT, lambda **kwargs: None)
    manifest_path = os.getenv("CELLRIX_MANIFEST", "examples/hello.json")
    try:
        _loaded_cell_manifest = parse_manifest(Path(manifest_path))
        logger.info("Loaded manifest from %s", manifest_path)
    except Exception as e:
        logger.warning("Could not load manifest from %s: %s. Using placeholder.", manifest_path, e)
        _loaded_cell_manifest = None
    _compute_and_cache_view_tree()
    set_daemon_context({"version": "1.0", "type": "cellrix"}, 80, 24)
    yield
    logger.info("Daemon shutting down – releasing resources.")
    set_daemon_context(None, 0, 0)
    _loaded_cell_manifest = None


def create_app() -> FastAPI:
    app = FastAPI(title="Cellrix Agent API", version="0.2.0", lifespan=daemon_lifespan)
    interceptor = ActionInterceptor()

    @app.get("/v1/agent/snapshot", response_model=SnapshotResponse)
    async def get_snapshot() -> SnapshotResponse:
        try:
            return _build_snapshot()
        except Exception:
            logger.exception("Snapshot generation failed")
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal error while building snapshot")

    @app.post("/v1/agent/action", response_model=ActionResponse)
    async def execute_action(request: ActionRequest) -> ActionResponse:
        try:
            result = interceptor.evaluate(action_def=None, action_name=request.action)
            if result == InterceptResult.CONFIRMATION_REQUIRED:
                return ActionResponse(
                    success=False,
                    message=f"Action '{request.action}' requires human confirmation.",
                    action_taken=request.action,
                )
            dispatch(request.action, **(request.payload or {}))
            return ActionResponse(
                success=True,
                message=f"Action '{request.action}' executed.",
                action_taken=request.action,
            )
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))
        except Exception:
            logger.exception("Unexpected error during action dispatch")
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal dispatch error")

    @app.websocket("/v1/ws/view")
    async def websocket_view(websocket: WebSocket):
        await websocket.accept()
        logger.info("WebSocket client connected")
        try:
            # Send the current ViewTree immediately (if available)
            if _view_tree_cache is not None:
                await websocket.send_text(json.dumps(_view_tree_cache))
            # Now wait for updates.  The event is set whenever _compute_and_cache_view_tree() runs.
            # In the current static manifest, no updates will occur, so the connection stays open silently.
            while True:
                await _view_tree_event.wait()
                if _view_tree_cache is not None:
                    await websocket.send_text(json.dumps(_view_tree_cache))
        except WebSocketDisconnect:
            logger.info("WebSocket client disconnected")
        except Exception as e:
            logger.exception("WebSocket error: %s", e)
        # No cleanup needed – connection closed automatically.

    return app
