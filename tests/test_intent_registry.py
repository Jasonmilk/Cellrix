"""CIS intent registry tests — loading, validation, static mapping."""

import json
import tempfile
from pathlib import Path
import pytest
from core.schemas.agent import CISRegistry, CISIntent, CISSecurity
from core.cis.registry import load_registry
from core.cis.static_map import dispatch_intent, register


def test_load_valid_registry():
    data = {
        "cis_version": "0.6",
        "intents": [
            {
                "id": "test_action",
                "name": "Test",
                "description": "A test action with no side effects."
            }
        ]
    }
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as f:
        json.dump(data, f)
    registry = load_registry(f.name)
    Path(f.name).unlink()
    assert len(registry.intents) == 1
    assert registry.intents[0].id == "test_action"


def test_invalid_registry_missing_id():
    data = {
        "cis_version": "0.6",
        "intents": [{"name": "Missing ID", "description": "Oops"}]
    }
    with pytest.raises(Exception):
        CISRegistry(**data)


def test_risk_level_must_be_valid():
    data = {
        "cis_version": "0.6",
        "intents": [
            {
                "id": "bad",
                "name": "Bad",
                "description": "Bad intent",
                "security": {"risk_level": "unknown"}
            }
        ]
    }
    with pytest.raises(Exception):
        CISRegistry(**data)


def test_static_map_dispatch():
    called = []
    register("my_action", lambda p: called.append(p))
    assert dispatch_intent("my_action", {"key": "val"}) is True
    assert called == [{"key": "val"}]


def test_static_map_unknown_intent():
    assert dispatch_intent("no_such_intent") is False
