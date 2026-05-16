"""
Cellrix theme management with strict Pydantic models and auto-discovery.

All theme files are validated against this schema before rendering.
Presets are automatically loaded from the stations/ directory tree.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Dict

from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger(__name__)


class ThemeTokens(BaseModel):
    """Set of semantic color tokens for a Cellrix theme."""

    model_config = ConfigDict(strict=True)

    primary: str = Field(..., pattern=r"^#[0-9a-fA-F]{6}$")
    secondary: str = Field(..., pattern=r"^#[0-9a-fA-F]{6}$")
    surface: str = Field(..., pattern=r"^#[0-9a-fA-F]{6}$")
    panel: str = Field(..., pattern=r"^#[0-9a-fA-F]{6}$")
    text: str = Field(..., pattern=r"^#[0-9a-fA-F]{6}$")
    text_muted: str = Field(..., pattern=r"^#[0-9a-fA-F]{6}$")
    border: str = Field(..., pattern=r"^#[0-9a-fA-F]{6}$")
    success: str = Field(..., pattern=r"^#[0-9a-fA-F]{6}$")
    warning: str = Field(..., pattern=r"^#[0-9a-fA-F]{6}$")
    error: str = Field(..., pattern=r"^#[0-9a-fA-F]{6}$")


class Theme(BaseModel):
    """A named theme containing color tokens."""

    model_config = ConfigDict(strict=True)

    name: str = Field(..., min_length=1)
    tokens: ThemeTokens


# ---------------------------------------------------------------------------
# Built-in presets (always available)
# ---------------------------------------------------------------------------

DEFAULT_THEME = Theme(
    name="dracula",
    tokens=ThemeTokens(
        primary="#bd93f9",
        secondary="#ff79c6",
        surface="#282a36",
        panel="#1e1f29",
        text="#f8f8f2",
        text_muted="#6272a4",
        border="#44475a",
        success="#50fa7b",
        warning="#ffb86c",
        error="#ff5555",
    ),
)

SLATE_DARK = Theme(
    name="slate-dark",
    tokens=ThemeTokens(
        primary="#60a5fa",
        secondary="#a78bfa",
        surface="#0f172a",
        panel="#1e293b",
        text="#f8fafc",
        text_muted="#94a3b8",
        border="#334155",
        success="#4ade80",
        warning="#fbbf24",
        error="#f87171",
    ),
)


# ---------------------------------------------------------------------------
# Global preset registry
# ---------------------------------------------------------------------------

PRESETS: Dict[str, Theme] = {
    "dracula": DEFAULT_THEME,
    "slate-dark": SLATE_DARK,
}


# ---------------------------------------------------------------------------
# Auto-discovery from stations/ directory
# ---------------------------------------------------------------------------

def discover_presets(root: str = "stations") -> None:
    """Scan *root*/<name>/theme.json and register discovered presets.

    Already registered names are skipped (no overwrite). Validation errors
    are logged and ignored to keep the runtime stable.
    """
    base = Path(root)
    if not base.is_dir():
        logger.debug("No stations/ directory found, skipping theme discovery.")
        return

    discovered = 0
    for entry in sorted(base.iterdir()):
        if not entry.is_dir():
            continue
        theme_file = entry / "theme.json"
        if not theme_file.is_file():
            continue
        try:
            theme = load_theme_from_file(str(theme_file))
            if theme.name in PRESETS:
                logger.debug("Theme '%s' already registered, skipping.", theme.name)
                continue
            PRESETS[theme.name] = theme
            discovered += 1
            logger.info("Discovered theme '%s' from %s", theme.name, theme_file)
        except Exception as exc:
            logger.warning("Failed to load theme from %s: %s", theme_file, exc)

    logger.info("Theme discovery complete: %d new preset(s) loaded.", discovered)


def load_theme_from_dict(data: dict) -> Theme:
    """Validate and return a Theme from a raw dictionary. Strict mode rejects unknown fields."""
    return Theme(**data)


def load_theme_from_file(path: str) -> Theme:
    """Read a JSON file and parse it as a Theme. Fail-fast on invalid content."""
    import json
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    return load_theme_from_dict(raw)
