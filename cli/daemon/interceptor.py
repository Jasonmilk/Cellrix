"""
Action Interceptor (HITL Gateway)

Enforces the human-in-the-loop security model defined in the Cell-Manifest.
Intercepts high-risk actions and requires explicit human approval before execution.

Zero hardcoded values — all thresholds read from environment or manifest.
"""

from __future__ import annotations

import os
from enum import Enum
from typing import Optional

from core.manifest.models import ActionDef, SecurityClass, ApprovalRequirement


class InterceptResult(Enum):
    APPROVED = "approved"
    CONFIRMATION_REQUIRED = "confirmation_required"


# Default timeout for human approval (seconds).
DEFAULT_HITL_TIMEOUT: int = int(os.getenv("CELLRIX_HITL_TIMEOUT", "30"))


class ActionInterceptor:
    """Non-persistent interceptor. Evaluates each action against manifest security rules."""

    def __init__(self, timeout: int = DEFAULT_HITL_TIMEOUT) -> None:
        self._timeout = timeout
        # In-memory storage for pending approvals. Keyed by action_name.
        self._pending: dict[str, ApprovalRequirement] = {}
        # Trace IDs associated with pending actions
        self._trace_ids: dict[str, str] = {}

    def evaluate(
        self,
        action_def: Optional[ActionDef],
        action_name: str,
        trace_id: Optional[str] = None,
    ) -> InterceptResult:
        """Determine whether an action can proceed immediately or requires HITL.

        Args:
            action_def: The action definition from the manifest (may be None).
            action_name: The dispatched action name (for fallback logic).
            trace_id: Optional trace ID from the originating request.

        Returns:
            APPROVED if the action may execute; CONFIRMATION_REQUIRED otherwise.
        """
        if action_def is None:
            return InterceptResult.APPROVED

        security_class: SecurityClass = action_def.security_class
        requires_approval: Optional[ApprovalRequirement] = action_def.requires_approval

        # CRITICAL actions always require approval, even if no explicit requirement is set.
        if security_class == SecurityClass.CRITICAL and requires_approval is None:
            requires_approval = ApprovalRequirement(
                prompt=f"Critical action '{action_name}' requires confirmation.",
                timeout=self._timeout * 1000,
                timeout_action="reject",
                fallbackEmit="action_rejected",
            )

        if requires_approval is not None:
            self._pending[action_name] = requires_approval
            if trace_id:
                self._trace_ids[action_name] = trace_id
            return InterceptResult.CONFIRMATION_REQUIRED

        return InterceptResult.APPROVED

    def approve(self, action_name: str) -> bool:
        """Simulate human approval for a pending action."""
        if action_name in self._pending:
            del self._pending[action_name]
            self._trace_ids.pop(action_name, None)
            return True
        return False

    def reject(self, action_name: str) -> str:
        """Simulate human rejection and return the fallback emit string."""
        requirement = self._pending.pop(action_name, None)
        self._trace_ids.pop(action_name, None)
        if requirement is not None:
            return requirement.fallback_emit
        return "no_pending_action"

    def generate_decision_id(self, action_name: str) -> str | None:
        """Generate a unique decision ID if the action is pending approval."""
        if action_name in self._pending:
            # Simple ID generation, can be enhanced later
            return f"decision_{action_name}_{len(self._pending)}"
        return None

    def query_decision(self, decision_id: str) -> dict:
        """Return the status of a decision by its ID."""
        if not decision_id.startswith("decision_"):
            return {"status": "unknown"}
        parts = decision_id[len("decision_"):].rsplit("_", 1)
        if len(parts) != 2:
            return {"status": "unknown"}
        action_name = parts[0]
        if action_name in self._pending:
            return {"status": "pending"}
        # Could be approved/rejected, but for now we only track pending state.
        # Once removed from _pending, decision is considered completed.
        return {"status": "unknown"}
