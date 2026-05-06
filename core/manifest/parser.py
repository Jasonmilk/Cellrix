# core/manifest/parser.py
"""Manifest parser and strict validator."""

import json
import warnings
from pathlib import Path

from pydantic import ValidationError

from .models import CellManifest


class ManifestError(Exception):
    """Custom error for manifest parsing failures."""
    pass


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
    if 'version' not in data:
        warnings.warn(
            "Manifest missing version field, falling back to v1.0 compatibility mode",
            DeprecationWarning,
            stacklevel=2,
        )
        data['version'] = "1.0"

    config = {"extra": "forbid" if strict else "ignore"}
    try:
        manifest = CellManifest.model_validate(data, config=config)
    except ValidationError as e:
        raise ManifestError(f"Manifest validation failed: {e}") from e

    # Collect all valid slot IDs recursively
    def collect_slot_ids(layout):
        ids = set()
        for slot in layout.slots:
            ids.add(slot.id)
            if slot.layout is not None:
                ids.update(collect_slot_ids(slot.layout))
        return ids

    all_slots = collect_slot_ids(manifest.layout)

    # §4.4: validate slot references
    for cell in manifest.cells:
        if cell.slot not in all_slots:
            raise ManifestError(f"Cell '{cell.id}' references undefined slot '{cell.slot}'")

    # §4.0: capabilities whitelist
    if manifest.capabilities:
        allowed_drivers = set(manifest.capabilities.drivers)
        allowed_actions = set(manifest.capabilities.actions_emit)
        for cell in manifest.cells:
            if cell.driver and cell.driver not in allowed_drivers:
                raise ManifestError(
                    f"Driver '{cell.driver}' not in capabilities.drivers whitelist"
                )
            for action in (cell.actions.on_press, cell.actions.on_focus):
                if action and action.emit not in allowed_actions:
                    raise ManifestError(
                        f"Action emit '{action.emit}' not in capabilities.actions_emit whitelist"
                    )

    return manifest