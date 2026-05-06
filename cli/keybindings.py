"""Keybindings map with strict precedence rules.

1. System‑reserved keys (hardcoded in the event loop, currently none).
2. Global user bindings (defined here).
3. Manifest‑provided actions (define in the manifest's `actions.onKey`).
4. User‑defined context bindings (future per‑panel overrides).

The `resolve` method returns an action name (e.g. 'quit', 'focus_next')
or `None` if the key is unknown.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple


# Minimal action constants – no need for a heavy enum yet.
QUIT = "quit"
FOCUS_NEXT = "focus_next"
FOCUS_PREV = "focus_prev"
TOGGLE_HELP = "toggle_help"


@dataclass
class Keybindings:
    """Manages key-to-action resolution with a safe default set."""
    global_bindings: Dict[str, str] = field(default_factory=dict)
    # per-panel bindings: key -> action
    context_bindings: Dict[str, Dict[str, str]] = field(default_factory=dict)

    def resolve(
        self,
        key: str,
        manifest_actions: Optional[List[Tuple[str, str]]] = None,
    ) -> Optional[str]:
        """Return the action associated with `key` according to precedence.

        Args:
            key: The raw key string returned by KeyReader.
            manifest_actions: Optional list of (key, action) tuples from
                the current cell's `actions.onKey` field. Manifest actions
                take precedence over user‑defined context bindings, but
                **never** override global bindings (to keep hard‑coded
                safety exits like 'q' un‑overridable).

        Returns:
            Action name like 'quit', 'focus_next', or None.
        """
        # ---- global bindings always win ----
        if key in self.global_bindings:
            return self.global_bindings[key]

        # ---- manifest actions are next (authoritative for that cell) ----
        if manifest_actions:
            for m_key, m_action in manifest_actions:
                if m_key == key:
                    return m_action

        # ---- user context bindings are the fallback ----
        # (In Phase 1 we don't populate these yet, but the hook is here)
        for ctx_bindings in self.context_bindings.values():
            if key in ctx_bindings:
                return ctx_bindings[key]

        return None


# Safe defaults that guarantee the user can always quit and get help.
DEFAULT_KEYBINDINGS = Keybindings(
    global_bindings={
        "q": QUIT,
        "f1": TOGGLE_HELP,
        "tab": FOCUS_NEXT,
        "shift+tab": FOCUS_PREV,
    }
)
