"""Static mapping from CIS intent IDs to Cellrix action handlers."""

from __future__ import annotations

from typing import Callable, Dict

# Handler signature: receives optional payload dict, returns nothing.
IntentHandler = Callable[[dict | None], None]

# Declaration of known intent-to-handler mappings.
# This table is statically defined, not built at startup.
# Future: load from a file or register dynamically from extensions.
_static_map: Dict[str, IntentHandler] = {}


def register(intent_id: str, handler: IntentHandler) -> None:
    """Register a handler for a given intent ID."""
    _static_map[intent_id] = handler


def dispatch_intent(intent_id: str, payload: dict | None = None) -> bool:
    """Execute the handler for the given intent. Returns False if no handler registered."""
    handler = _static_map.get(intent_id)
    if handler is None:
        return False
    handler(payload)
    return True
