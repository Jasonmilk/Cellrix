"""Tests for security module."""

from __future__ import annotations

import pytest

from core.security.sanitizer import SecurityError, sanitize
from core.security.validator import validate_network_target


def test_sanitize_clean() -> None:
    assert sanitize("Hello world") == "Hello world"

def test_sanitize_ansi_raises() -> None:
    with pytest.raises(SecurityError):
        sanitize("\x1b[31mHello\x1b[0m")

def test_network_ip_allowed() -> None:
    validate_network_target(["192.168.1.0/24"], "192.168.1.5")

def test_network_ip_denied() -> None:
    with pytest.raises(SecurityError):
        validate_network_target(["192.168.1.0/24"], "8.8.8.8")

def test_domain_wildcard_allowed() -> None:
    validate_network_target(["*.example.com"], "api.example.com")

def test_domain_wildcard_denied_root() -> None:
    with pytest.raises(SecurityError):
        validate_network_target(["*.example.com"], "example.com")
