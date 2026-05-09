# cli/input_router.py
"""
Multi‑level input router with leader‑key support.

Resolves raw key events into standard Cellrix action names,
respecting the precedence:
    Global hard‑coded > Manifest onKey > built‑in defaults.

Philosophy:
- Orchestrate, Don't Build: this module only translates keys.
- Absolute Idempotency: the same key sequence always produces
  the same action name.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Tuple


def _normalize_key(raw: str) -> str:
    """Map raw bytes/escape sequences to canonical key names."""
    if raw in ('\x1bOP', '\x1b[11~', '\x1bOQ'):
        return 'f1'
    if raw == '\x1b[Z':
        return 'shift+tab'
    if raw == '\x1b[A':
        return 'up'
    if raw == '\x1b[B':
        return 'down'
    if raw == '\x1b[C':
        return 'right'
    if raw == '\x1b[D':
        return 'left'
    if raw == '\x1b[5~':
        return 'page_up'
    if raw == '\x1b[6~':
        return 'page_down'
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
    if raw.startswith('\x1b') and len(raw) > 1:
        char = raw[1:].lower()
        if char.isalpha() and len(char) == 1:
            return f'alt+{char}'
    if len(raw) == 1 and raw.isprintable():
        return raw.lower()
    return raw


DEFAULT_BINDINGS: Dict[str, str] = {
    "tab": "focus_next",
    "shift+tab": "focus_prev",
    "f1": "toggle_help",
    "q": "quit",
    "escape": "quit",
    "up": "scroll_up",
    "down": "scroll_down",
    "page_up": "scroll_page_up",
    "page_down": "scroll_page_down",
    "home": "scroll_home",
    "end": "scroll_end",
    "?": "toggle_help",
    # Leader‑key prefix – no direct action
}


class InputRouter:
    """Resolves raw keys to action names, optionally using a leader‑key
    state machine."""

    def __init__(self) -> None:
        self._leader_pending: bool = False

    def resolve(
        self,
        raw: str,
        manifest_on_key: Optional[List[Tuple[str, str]]] = None,
    ) -> Optional[str]:
        """Return the standard action name for *raw*, or None.

        Args:
            raw: Raw key string from readchar / KeyReader.
            manifest_on_key: Optional list of (key, action) defined in the
                currently focused cell's `actions.onKey` field.
        """
        key = _normalize_key(raw)

        # ---- Leader‑key state machine ----
        if self._leader_pending:
            self._leader_pending = False
            # Accept a single a‑z letter
            if key.isalpha() and len(key) == 1 and key.islower():
                index = ord(key) - ord('a')
                return f"focus_index:{index}"
            return None

        if key == "g" and not self._leader_pending:
            self._leader_pending = True
            return None

        # ---- Global hard‑coded overrides ----
        if key == "q" or key == "escape":
            return "quit"

        # ---- Manifest onKey (per‑panel) ----
        if manifest_on_key:
            for m_key, m_action in manifest_on_key:
                if _normalize_key(m_key) == key:
                    return m_action

        # ---- Built‑in defaults ----
        return DEFAULT_BINDINGS.get(key)

    def is_leader_active(self) -> bool:
        return self._leader_pending

    def reset_leader(self) -> None:
        self._leader_pending = False
