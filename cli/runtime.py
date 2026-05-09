"""Cellrix runtime controller.

Provides a self‑contained interactive loop that ties together the
Rich renderer, keyboard input, and dynamic data sources.
The loop can be embedded directly into a Python application
(no click dependency required).
"""

from __future__ import annotations

from typing import Any, Dict, Optional

import readchar
from rich.live import Live

from core.manifest.models import CellManifest
from core.source import SourceManager
from .renderer import CellrixRenderer
from .theme import Theme, DEFAULT_THEME
from .keybindings import (
    Keybindings,
    DEFAULT_KEYBINDINGS,
)
from .input_router import InputRouter
from . import actions

# Re‑export constants for backward compatibility
QUIT = actions.QUIT
FOCUS_NEXT = actions.FOCUS_NEXT
FOCUS_PREV = actions.FOCUS_PREV
TOGGLE_HELP = actions.TOGGLE_HELP


class CellrixRuntime:
    """Interactive engine that owns the Rich Live loop."""

    def __init__(
        self,
        manifest: CellManifest,
        theme: Theme = DEFAULT_THEME,
        keybindings: Keybindings = DEFAULT_KEYBINDINGS,
        source_manager: Optional[SourceManager] = None,
    ) -> None:
        self.renderer = CellrixRenderer(
            manifest,
            theme=theme,
            keybindings=keybindings,
            source_manager=source_manager,
        )
        self.source_manager = source_manager
        self.router = InputRouter()

        # Register action handlers
        actions.clear()   # safety for multiple runs
        actions.register(actions.QUIT, lambda: None)
        actions.register(actions.FOCUS_NEXT, self._focus_next)
        actions.register(actions.FOCUS_PREV, self._focus_prev)
        actions.register(actions.TOGGLE_HELP, self._toggle_help)
        actions.register(actions.SCROLL_UP, self._scroll_up)
        actions.register(actions.SCROLL_DOWN, self._scroll_down)
        actions.register(actions.SCROLL_PAGE_UP, self._scroll_page_up)
        actions.register(actions.SCROLL_PAGE_DOWN, self._scroll_page_down)
        actions.register(actions.SCROLL_HOME, self._scroll_home)
        actions.register(actions.SCROLL_END, self._scroll_end)
        actions.register(actions.FOCUS_INDEX, self._focus_index)
        actions.register(actions.LEADER_PREFIX, lambda: setattr(self.renderer.state, 'leader_active', True))

    def run(self) -> None:
        """Start the main event loop (blocking)."""
        with Live(
            self.renderer, screen=True, refresh_per_second=10
        ) as live:
            try:
                while True:
                    raw = readchar.readkey()

                    # Special handling: Esc always closes help first
                    if raw == '\x1b' and (self.renderer.state.show_shortcuts or self.renderer.state.full_help):
                        self._toggle_help()
                        continue

                    manifest_actions = self.renderer._get_focused_manifest_actions()
                    action = self.router.resolve(raw, manifest_actions)

                    if action is None:
                        self.renderer.state.leader_active = self.router.is_leader_active()
                        continue

                    if action.startswith("focus_index:"):
                        try:
                            idx = int(action.split(":")[1])
                            self._focus_by_index(idx)
                        except Exception:
                            pass
                    elif action == actions.QUIT:
                        break
                    else:
                        actions.dispatch(action)

                    self.renderer.state.leader_active = self.router.is_leader_active()

            except KeyboardInterrupt:
                pass
            finally:
                if self.source_manager is not None:
                    self.source_manager.shutdown()

    # ------------------------------------------------------------------
    # Handler implementations
    # ------------------------------------------------------------------
    def _focus_next(self) -> None:
        if self.renderer._flat_nodes:
            self.renderer.state.focus_index = (
                self.renderer.state.focus_index + 1
            ) % len(self.renderer._flat_nodes)

    def _focus_prev(self) -> None:
        if self.renderer._flat_nodes:
            self.renderer.state.focus_index = (
                self.renderer.state.focus_index - 1
            ) % len(self.renderer._flat_nodes)

    def _focus_index(self, payload: Optional[Dict[str, Any]] = None) -> None:
        if payload and 'index' in payload:
            idx = int(payload['index'])
            self._focus_by_index(idx)

    def _focus_by_index(self, idx: int) -> None:
        if self.renderer._flat_nodes and 0 <= idx < len(self.renderer._flat_nodes):
            self.renderer.state.focus_index = idx

    def _toggle_help(self) -> None:
        """Two‑state toggle for the shortcut overlay."""
        state = self.renderer.state
        if state.show_shortcuts or state.full_help:
            state.show_shortcuts = False
            state.full_help = False
        else:
            state.show_shortcuts = True
            state.full_help = False   # only one help mode for now

    # Scroll helpers
    def _scroll(self, amount: int) -> None:
        cell = self.renderer.get_focused_cell()
        if cell is None or cell.collapse_mode != "scroll":
            return
        offsets = self.renderer.state.scroll_offsets
        current = offsets.get(cell.id, 0)
        offsets[cell.id] = max(0, current + amount)

    def _scroll_up(self) -> None:
        self._scroll(-1)

    def _scroll_down(self) -> None:
        self._scroll(1)

    def _scroll_page_up(self) -> None:
        page = self.renderer.state.last_height // 3
        self._scroll(-page)

    def _scroll_page_down(self) -> None:
        page = self.renderer.state.last_height // 3
        self._scroll(page)

    def _scroll_home(self) -> None:
        cell = self.renderer.get_focused_cell()
        if cell and cell.collapse_mode == "scroll":
            self.renderer.state.scroll_offsets[cell.id] = 0

    def _scroll_end(self) -> None:
        cell = self.renderer.get_focused_cell()
        if cell and cell.collapse_mode == "scroll":
            self.renderer.state.scroll_offsets[cell.id] = 10**9
