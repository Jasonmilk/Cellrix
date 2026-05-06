"""Manifest parser and strict validator."""

import json
import warnings
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from .models import CellManifest, Layout


class ManifestError(Exception):
    """Custom error for manifest parsing failures."""


def parse_manifest(source: str | Path, strict: bool = False) -> CellManifest:
    """Parse and validate a Cell-Manifest from JSON file or string.

    Args:
        source: Path to JSON file or raw JSON string.
        strict: If True, reject unknown fields (dev mode).

    Returns:
        Validated CellManifest instance.

    Raises:
        ManifestError: If the manifest is invalid.
    """
    raw = source.read_text(encoding="utf-8") if isinstance(source, Path) else source

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ManifestError(f"Invalid JSON: {e}") from e

    # Whitepaper §4.4: version fallback
    if "version" not in data:
        warnings.warn(
            "Manifest missing version field, falling back to v1.0 compatibility mode",
            DeprecationWarning,
            stacklevel=2,
        )
        data["version"] = "1.0"

    if strict:
        _check_unknown_fields(data)

    try:
        manifest = CellManifest.model_validate(data)
    except ValidationError as e:
        raise ManifestError(f"Manifest validation failed: {e}") from e

    # §4.4: validate all cell slot references
    all_slots = _collect_slot_ids(manifest.layout)
    for cell in manifest.cells:
        if cell.slot not in all_slots:
            raise ManifestError(f"Cell '{cell.id}' references undefined slot '{cell.slot}'")

    # §4.0: capabilities whitelist validation
    if manifest.capabilities:
        allowed_drivers = set(manifest.capabilities.drivers)
        allowed_actions = set(manifest.capabilities.actions_emit)
        for cell in manifest.cells:
            if cell.driver and cell.driver not in allowed_drivers:
                raise ManifestError(f"Driver '{cell.driver}' not in capabilities.drivers whitelist")
            if cell.actions is not None:
                for action in (cell.actions.on_press, cell.actions.on_focus):
                    if action is not None and action.emit not in allowed_actions:
                        msg = (
                            f"Action emit '{action.emit}' "
                            f"not in capabilities.actions_emit whitelist"
                        )
                        raise ManifestError(msg)

    return manifest


def _check_unknown_fields(data: dict[str, Any]) -> None:
    """Reject unknown top-level fields in strict mode."""
    known_fields = {"version", "capabilities", "layout", "cells"}
    unknown = set(data.keys()) - known_fields
    if unknown:
        raise ManifestError(f"Unknown top-level field(s) in strict mode: {sorted(unknown)}")


def _collect_slot_ids(layout: Layout) -> set[str]:
    """Recursively collect all slot IDs from a layout (including nested)."""
    ids: set[str] = set()
    for slot in layout.slots:
        ids.add(slot.id)
        if slot.layout is not None:
            ids.update(_collect_slot_ids(slot.layout))
    return ids
