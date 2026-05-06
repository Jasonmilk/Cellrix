"""Cellrix runtime controller.

Provides a self‑contained interactive loop that ties together the
Rich renderer, keyboard input, and dynamic data sources.
The loop can be embedded directly into a Python application
(no click dependency required).
"""

from __future__ import annotations

import queue
import threading
from typing import Optional

import readchar
from rich.live import Live

from core.manifest.models import CellManifest
from core.source import SourceManager
from .renderer import CellrixRenderer
from .theme import Theme, DEFAULT_THEME
from .keybindings import (
    Keybindings,
    DEFAULT_KEYBINDINGS,
    QUIT,
    FOCUS_NEXT,
    FOCUS_PREV,
    TOGGLE_HELP,
)

# ---------------------------------------------------------------------------
# Key‑code normalisation (used internally by the runtime)
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# Runtime controller
# ---------------------------------------------------------------------------
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
            manifest, theme=theme, keybindings=keybindings
        )
        self.source_manager = source_manager
        self.theme = theme
        self.keybindings = keybindings
        self._key_queue: queue.Queue[str] = queue.Queue()
        self._stop_reading = threading.Event()

    def _read_keys(self) -> None:
        """Blocking key reader running in a daemon thread."""
        try:
            while not self._stop_reading.is_set():
                key = readchar.readkey()
                self._key_queue.put(key)
        except (EOFError, OSError):
            pass

    def run(self) -> None:
        """Start the main event loop (blocking)."""
        reader_thread = threading.Thread(target=self._read_keys, daemon=True)
        reader_thread.start()

        with Live(self.renderer, screen=True, refresh_per_second=10) as live:
            try:
                while True:
                    # Dynamic data poll (runs on every frame)
                    if self.source_manager is not None:
                        updates = self.source_manager.poll_all()
                        if updates:
                            self.renderer.update_dynamic_content(updates)

                    # Non‑blocking key processing
                    try:
                        raw = self._key_queue.get_nowait()
                        action = self._resolve_action(raw)
                        if action == QUIT or action == 'q':
                            break
                        self._apply_action(action)
                    except queue.Empty:
                        pass

            except KeyboardInterrupt:
                pass
            finally:
                self._stop_reading.set()
                if self.source_manager is not None:
                    self.source_manager.shutdown()
                reader_thread.join(timeout=0.5)

    def _resolve_action(self, raw: str) -> str:
        key = _normalize_key(raw)
        manifest_actions = self.renderer._get_focused_manifest_actions()
        resolved = self.renderer.keybindings.resolve(key, manifest_actions)
        return resolved or ""

    def _apply_action(self, action: str) -> None:
        if action == FOCUS_NEXT:
            if self.renderer._flat_nodes:
                self.renderer.state.focus_index = (
                    self.renderer.state.focus_index + 1
                ) % len(self.renderer._flat_nodes)
        elif action == FOCUS_PREV:
            if self.renderer._flat_nodes:
                self.renderer.state.focus_index = (
                    self.renderer.state.focus_index - 1
                ) % len(self.renderer._flat_nodes)
        elif action == TOGGLE_HELP:
            self.renderer.state.full_help = not self.renderer.state.full_help
