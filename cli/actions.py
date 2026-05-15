# cli/actions.py
"""
Cellrix standard actions and handler registry.

Centralises intent names so that input routers and the runtime
can communicate through plain strings without hard‑coding
behaviour anywhere else.

Philosophy:
- Strict Contracts: every action is an explicit constant.
- Radical Simplicity: one file instead of two.
"""

from __future__ import annotations

from typing import Any, Callable, Dict, Optional

# ---------------------------------------------------------------------------
# Action constants
# ---------------------------------------------------------------------------
QUIT: str = "quit"
FOCUS_NEXT: str = "focus_next"
FOCUS_PREV: str = "focus_prev"
FOCUS_INDEX: str = "focus_index"          # payload: {"index": int}
TOGGLE_HELP: str = "toggle_help"
SCROLL_UP: str = "scroll_up"
SCROLL_DOWN: str = "scroll_down"
SCROLL_PAGE_UP: str = "scroll_page_up"
SCROLL_PAGE_DOWN: str = "scroll_page_down"
SCROLL_HOME: str = "scroll_home"
SCROLL_END: str = "scroll_end"
LEADER_PREFIX: str = "leader_prefix"  # internal marker

# ---------------------------------------------------------------------------
# Handler registry
# ---------------------------------------------------------------------------
Handler = Callable[..., None]

_handlers: Dict[str, Handler] = {}

def register(action: str, handler: Handler) -> None:
    """Associate an action with its implementation."""
    _handlers[action] = handler

def dispatch(action: str, *args: Any, **kwargs: Any) -> None:
    """Execute the handler for *action*, if registered.
    
    Raises:
        ValueError: If the action is not registered.
    """
    handler = _handlers.get(action)
    if handler is None:
        raise ValueError(f"Unknown action: {action}")
    handler(*args, **kwargs)

def clear() -> None:
    """Remove all registered handlers (useful in tests)."""
    _handlers.clear()
