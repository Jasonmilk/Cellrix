"""
Theme model tests (P1c)

Covers token completeness, hex validation, strict rejection,
and preset integrity.
"""

import pytest
from pydantic import ValidationError
from cli.theme import Theme, ThemeTokens, load_theme_from_dict, PRESETS


def test_dracula_preset_is_valid():
    theme = PRESETS["dracula"]
    assert theme.name == "dracula"
    assert theme.tokens.primary == "#bd93f9"


def test_slate_dark_preset_is_valid():
    theme = PRESETS["slate-dark"]
    assert theme.tokens.primary == "#60a5fa"


def test_valid_theme_from_dict():
    data = {
        "name": "test",
        "tokens": {
            "primary": "#000000",
            "secondary": "#000000",
            "surface": "#000000",
            "panel": "#000000",
            "text": "#ffffff",
            "text_muted": "#aaaaaa",
            "border": "#333333",
            "success": "#00ff00",
            "warning": "#ffaa00",
            "error": "#ff0000",
        },
    }
    theme = load_theme_from_dict(data)
    assert theme.name == "test"


def test_missing_token_field_rejected():
    data = {
        "name": "broken",
        "tokens": {
            "primary": "#000000"
        },
    }
    with pytest.raises(ValidationError):
        load_theme_from_dict(data)


def test_invalid_hex_rejected():
    data = {
        "name": "bad",
        "tokens": {
            "primary": "blue",
            "secondary": "#000000",
            "surface": "#000000",
            "panel": "#000000",
            "text": "#ffffff",
            "text_muted": "#aaaaaa",
            "border": "#333333",
            "success": "#00ff00",
            "warning": "#ffaa00",
            "error": "#ff0000",
        },
    }
    with pytest.raises(ValidationError):
        load_theme_from_dict(data)


def test_unknown_field_rejected():
    data = {
        "name": "extra",
        "tokens": {
            "primary": "#000000",
            "secondary": "#000000",
            "surface": "#000000",
            "panel": "#000000",
            "text": "#ffffff",
            "text_muted": "#aaaaaa",
            "border": "#333333",
            "success": "#00ff00",
            "warning": "#ffaa00",
            "error": "#ff0000",
        },
        "unknown": "should not be here",
    }
    with pytest.raises(ValidationError):
        load_theme_from_dict(data)


def test_all_presets_have_10_tokens():
    for name, theme in PRESETS.items():
        tokens_dict = theme.tokens.model_dump()
        assert len(tokens_dict) == 10, f"Preset '{name}' has {len(tokens_dict)} tokens, expected 10"
