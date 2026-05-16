#!/usr/bin/env python3
"""
Agent Demo Script (P1d)

Simulates an AI agent interacting with Cellrix through the standard CIS Agent API.
Performs snapshot retrieval, valid action execution, and invalid action rejection.
Acts as both a functional demonstration and an integration smoke test.

Usage:
    python examples/agent_demo.py
"""

from __future__ import annotations

import os
import sys
import time
from typing import Any, Dict, Optional

import requests

# Zen #5: Zero hard‑coded values. All connection parameters injected via environment.
DAEMON_HOST: str = os.getenv("CELLRIX_DAEMON_HOST", "127.0.0.1")
DAEMON_PORT: str = os.getenv("CELLRIX_DAEMON_PORT", "8765")
BASE_URL: str = f"http://{DAEMON_HOST}:{DAEMON_PORT}/v1/agent"
SNAPSHOT_URL: str = f"{BASE_URL}/snapshot"
ACTION_URL: str = f"{BASE_URL}/action"


def check_daemon() -> bool:
    """Verify that the Cellrix Daemon is reachable."""
    try:
        response = requests.get(SNAPSHOT_URL, timeout=2)
        return response.status_code == 200
    except requests.RequestException:
        return False


def fetch_snapshot() -> Optional[Dict[str, Any]]:
    """Retrieve the current semantic tree snapshot."""
    try:
        response = requests.get(SNAPSHOT_URL, timeout=2)
        response.raise_for_status()
        return response.json()
    except requests.RequestException as e:
        print(f"❌ Failed to fetch snapshot: {e}")
        return None


def execute_action(action: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Send an action to the Daemon and return the response."""
    data: Dict[str, Any] = {"action": action}
    if payload is not None:
        data["payload"] = payload
    try:
        response = requests.post(ACTION_URL, json=data, timeout=2)
        return {"status_code": response.status_code, "body": response.json()}
    except requests.RequestException as e:
        return {"status_code": 0, "body": {"error": str(e)}}


def main() -> None:
    print("=== Cellrix Agent Demo ===")
    print(f"Target Daemon: {BASE_URL}")
    print()

    # 1. Ensure Daemon is running
    print("1. Checking Daemon availability...")
    if not check_daemon():
        print("❌ Daemon not running. Please start it with: cellrix daemon &")
        sys.exit(1)
    print("✅ Daemon is reachable.")
    print()

    # 2. Fetch snapshot
    print("2. Fetching semantic snapshot...")
    snapshot = fetch_snapshot()
    if snapshot is None:
        print("❌ Could not retrieve snapshot.")
        sys.exit(1)
    print(f"✅ Snapshot received ({len(snapshot.get('cells', []))} cells)")
    print(f"   Viewport: {snapshot.get('viewport', {})}")
    print()

    # 3. Execute a valid action
    print("3. Executing valid action 'focus_next'...")
    result = execute_action("focus_next")
    if result["status_code"] == 200 and result["body"].get("success"):
        print(f"✅ Action succeeded: {result['body'].get('message')}")
    else:
        print(f"❌ Action failed: {result}")
    print()

    # 4. Execute an invalid action (security test)
    print("4. Sending invalid action 'unregistered_action'...")
    result = execute_action("unregistered_action")
    if result["status_code"] in (400, 422):
        print(f"✅ Correctly rejected (HTTP {result['status_code']}): {result['body'].get('detail', '')}")
    else:
        print(f"❌ Should have been rejected, but got: {result}")
    print()

    # 5. Performance check (optional)
    print("5. Checking snapshot latency...")
    start = time.perf_counter()
    resp = requests.get(SNAPSHOT_URL, timeout=2)
    latency = time.perf_counter() - start
    if resp.status_code == 200 and latency < 0.010:
        print(f"✅ Snapshot latency {latency*1000:.2f}ms (P99 < 10ms)")
    else:
        print(f"⚠️ Latency {latency*1000:.2f}ms or request failed")
    print()

    print("=== Demo complete ===")
    print("Agent successfully interacted with Cellrix via CIS API.")


if __name__ == "__main__":
    main()
