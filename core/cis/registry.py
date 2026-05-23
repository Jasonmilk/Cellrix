"""CIS intent registry loader and validator."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from core.schemas.agent import CISRegistry

logger = logging.getLogger(__name__)


def load_registry(path: str) -> CISRegistry:
    """Load a CIS intent registry from a JSON file. Strict validation."""
    raw = Path(path).read_text(encoding="utf-8")
    data = json.loads(raw)
    registry = CISRegistry(**data)
    logger.info("Loaded intent registry with %d intents from %s", len(registry.intents), path)
    return registry
