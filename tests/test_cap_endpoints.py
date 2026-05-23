"""CAP endpoint tests — Manifest, Decisions queue."""

import pytest
from fastapi.testclient import TestClient
from cli.daemon.agent_routes import create_app


@pytest.fixture
def client():
    app = create_app()
    return TestClient(app)


def test_cap_manifest_returns_valid_structure(client):
    response = client.get("/v1/cap/manifest")
    assert response.status_code == 200
    data = response.json()
    assert data["runtime"] == "Cellrix"
    assert "version" in data
    assert "capabilities" in data
    assert data["trace_id_support"] is True


def test_cap_manifest_capabilities_flags(client):
    response = client.get("/v1/cap/manifest")
    caps = response.json()["capabilities"]
    assert caps["snapshot"] is True
    assert caps["action"] is True
    assert caps["hitl"] is True
    assert caps["decisions"] is True  # now implemented


def test_decisions_submit_invalid_id(client):
    response = client.post("/v1/cap/decisions", json={"decision_id": "bad", "approval": True})
    assert response.status_code == 422


def test_decisions_submit_unknown_action(client):
    # No pending action, so approval should fail
    response = client.post("/v1/cap/decisions", json={"decision_id": "decision_nonexist_1", "approval": True})
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is False


def test_decisions_status_unknown(client):
    response = client.get("/v1/cap/decisions/decision_nonexist_1")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "unknown"
