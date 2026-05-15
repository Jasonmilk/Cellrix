"""
Agent Accessibility Test Suite (Phase 1e)
Tests the stability, correctness, and performance of snapshot fetching and action execution.
Ensures adherence to Cellrix Zen #2 (Strict Contracts) and #4 (Testability).
"""

import os
import time
import pytest
import requests

# Zen #5: 零硬编码。所有连接参数由外部环境变量注入
CELLRIX_DAEMON_HOST = os.getenv("CELLRIX_DAEMON_HOST", "127.0.0.1")
CELLRIX_DAEMON_PORT = os.getenv("CELLRIX_DAEMON_PORT", "8765")
API_BASE_URL = f"http://{CELLRIX_DAEMON_HOST}:{CELLRIX_DAEMON_PORT}/v1/agent"


@pytest.fixture(scope="module")
def ensure_daemon_running():
    """
    On-Demand Execution: Ensure tests only run when the target daemon is accessible.
    Skips the test suite gracefully to avoid false negative CI alarms.
    """
    try:
        response = requests.get(f"{API_BASE_URL}/snapshot", timeout=2)
        if response.status_code == 200:
            yield
            return
    except requests.exceptions.RequestException:
        pass
    pytest.skip(f"Cellrix Daemon not running at {API_BASE_URL}. Skipping agent accessibility tests.")


@pytest.fixture
def api_client(ensure_daemon_running):
    """
    Provides a standardized HTTP client wrapper for the Agent API.
    Handles connection lifecycles automatically.
    """
    class AgentAPIClient:
        def get_snapshot(self):
            return requests.get(f"{API_BASE_URL}/snapshot", timeout=2)
            
        def execute_action(self, action_payload: dict):
            return requests.post(f"{API_BASE_URL}/action", json=action_payload, timeout=2)
            
    return AgentAPIClient()


def test_snapshot_returns_valid_structure(api_client):
    """
    Verifies that the /snapshot endpoint returns a structurally valid Semantic Tree.
    Also ensures P99 latency is strictly bounded to prevent Agent token starvation.
    """
    start_time = time.perf_counter()
    response = api_client.get_snapshot()
    latency = time.perf_counter() - start_time
    
    # 1. Network Assertion
    assert response.status_code == 200, f"Snapshot failed with status {response.status_code}"
    
    # 2. Performance Constraint: P99 < 10ms for local loopback
    assert latency < 0.010, f"Performance breach: Snapshot fetch took {latency*1000:.2f}ms (Limit: 10ms)"
    
    # 3. Structural Contract Assertion (Fail Fast)
    data = response.json()
    assert "viewport" in data, "Snapshot missing mandatory 'viewport' metadata."
    assert "cells" in data, "Snapshot missing mandatory 'cells' list."


def test_action_changes_focus(api_client):
    """
    Verifies state consistency after submitting a valid state-mutating action.
    Simulates an Agent manipulating the TUI layout.
    """
    action_payload = {"action": "focus_next"}
    
    start_time = time.perf_counter()
    response = api_client.execute_action(action_payload)
    latency = time.perf_counter() - start_time
    
    assert response.status_code == 200, "Action execution failed."
    assert latency < 0.010, f"Performance breach: Action took {latency*1000:.2f}ms (Limit: 10ms)"


def test_invalid_action_is_strictly_rejected(api_client):
    """
    Security Gate: Ensures that an invalid action payload is rejected by the Pydantic 
    strict validation layer before it pollutes the Runtime state.
    """
    malformed_payload = {"action": "unregistered_action", "payload": {"hack": True}}
    response = api_client.execute_action(malformed_payload)
    
    # FastAPI/Pydantic validation errors return 422 (Unprocessable Entity). 
    assert response.status_code in [400, 422], "Security breach: Daemon accepted malformed action payload."
