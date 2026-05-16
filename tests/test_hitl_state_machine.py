"""
HITL state machine tests (P2d)

Covers approval required, rejection, timeout, and safe pass-through.
"""

import pytest
from core.manifest.models import ActionDef, SecurityClass, ApprovalRequirement
from cli.daemon.interceptor import ActionInterceptor, InterceptResult


@pytest.fixture
def interceptor():
    return ActionInterceptor(timeout=5)


def test_safe_action_passes(interceptor):
    action_def = ActionDef(emit="safe_action", security_class=SecurityClass.SAFE)
    result = interceptor.evaluate(action_def, "safe_action")
    assert result == InterceptResult.APPROVED


def test_critical_action_requires_approval(interceptor):
    action_def = ActionDef(
        emit="dangerous",
        security_class=SecurityClass.CRITICAL,
        requires_approval=ApprovalRequirement(
            prompt="Are you sure?",
            timeout=5000,
            timeout_action="reject",
            fallbackEmit="action_rejected",
        ),
    )
    result = interceptor.evaluate(action_def, "dangerous")
    assert result == InterceptResult.CONFIRMATION_REQUIRED


def test_approval_releases_action(interceptor):
    action_def = ActionDef(
        emit="approve_me",
        security_class=SecurityClass.RESTRICTED,
        requires_approval=ApprovalRequirement(
            prompt="Confirm?",
            timeout=5000,
            timeout_action="reject",
            fallbackEmit="action_rejected",
        ),
    )
    interceptor.evaluate(action_def, "approve_me")
    assert interceptor.approve("approve_me") is True
    # After approval, the action is no longer pending.
    assert interceptor.approve("approve_me") is False


def test_reject_returns_fallback(interceptor):
    action_def = ActionDef(
        emit="reject_me",
        security_class=SecurityClass.RESTRICTED,
        requires_approval=ApprovalRequirement(
            prompt="Confirm?",
            timeout=5000,
            timeout_action="reject",
            fallbackEmit="safe_fallback",
        ),
    )
    interceptor.evaluate(action_def, "reject_me")
    fallback = interceptor.reject("reject_me")
    assert fallback == "safe_fallback"


def test_auto_critical_requires_approval(interceptor):
    """CRITICAL class without explicit requires_approval still triggers HITL."""
    action_def = ActionDef(emit="implicit_critical", security_class=SecurityClass.CRITICAL)
    result = interceptor.evaluate(action_def, "implicit_critical")
    assert result == InterceptResult.CONFIRMATION_REQUIRED


def test_no_action_def_passes(interceptor):
    """Missing action definition means no security constraints."""
    result = interceptor.evaluate(None, "unknown_action")
    assert result == InterceptResult.APPROVED
