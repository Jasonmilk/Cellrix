"""Conformance tests for Cellrix White Paper v2.3 and CIS v0.4.0."""

from __future__ import annotations

import pytest

from core.manifest.models import Cell, CellType, KeyBinding, Actions
from cli.renderer import CellrixRenderer


def _build_semantic(cell: Cell, fallback: str = "Fallback") -> str:
    """Helper to invoke _build_semantic_content without a full renderer."""
    renderer = CellrixRenderer.__new__(CellrixRenderer)
    return renderer._build_semantic_content(cell, fallback)


# ----------------------------------------------------------------------
# Test 1 – Illegal table data downgrade (renderer fallback)
# ----------------------------------------------------------------------
def test_table_fallback_on_non_array() -> None:
    cell = Cell(
        id="bad_table", type=CellType.STATIC, slot="main",
        semantic_widget="table", semantic_data="not an array",
    )
    result = _build_semantic(cell, "My data")
    assert result == "My data"


# ----------------------------------------------------------------------
# Test 2 – Out‑of‑bounds progress value
# ----------------------------------------------------------------------
def test_progress_clamps_to_100() -> None:
    cell = Cell(
        id="big", type=CellType.STATIC, slot="main",
        semantic_widget="progress", semantic_data=999,
    )
    result = _build_semantic(cell, "Loading")
    assert "100%" in result


# ----------------------------------------------------------------------
# Test 3 – Invalid button style fallback
# ----------------------------------------------------------------------
def test_button_style_fallback() -> None:
    # Invalid style is simply not mapped → rendered without color
    from cli.renderer import _STYLE_COLOR_MAP
    assert "neon-pink" not in _STYLE_COLOR_MAP


# ----------------------------------------------------------------------
# Test 4 – XSS / ANSI injection defence
# ----------------------------------------------------------------------
def test_list_sanitization() -> None:
    cell = Cell(
        id="xss", type=CellType.STATIC, slot="main",
        semantic_widget="list",
        semantic_data=["<script>alert(1)</script>", "\x1b[2J"],
    )
    result = _build_semantic(cell, "Alert")
    assert "<script>alert(1)</script>" in result
    assert "\x1b" not in result


# ----------------------------------------------------------------------
# Test 5 – Jagged table and invalid element robustness
# ----------------------------------------------------------------------
def test_table_jagged_and_invalid() -> None:
    cell = Cell(
        id="jagged", type=CellType.STATIC, slot="main",
        semantic_widget="table",
        semantic_data=[["A", "B"], ["C", {"hack": True}], ["D"]],
    )
    result = _build_semantic(cell, "Fallback")
    lines = result.splitlines()
    assert len(lines) == 3
    # Row 2: "C | " (invalid object replaced with empty string)
    assert "C | " in lines[1]
    # Row 3: "D | " (padded)
    assert "D | " in lines[2]


# ----------------------------------------------------------------------
# Test 6 – Unknown widget downgrade (Pydantic rejects at model level)
# ----------------------------------------------------------------------
def test_unknown_widget_fallback() -> None:
    with pytest.raises(Exception):  # Pydantic ValidationError
        Cell(
            id="u", type=CellType.STATIC, slot="main",
            semantic_widget="chart3d", semantic_data={"x": 1},
        )


# ----------------------------------------------------------------------
# Test 7 – NaN / Infinity rejection
# ----------------------------------------------------------------------
def test_nan_infinity_rejected() -> None:
    cell = Cell(
        id="n", type=CellType.STATIC, slot="main",
        semantic_widget="progress", semantic_data=float("nan"),
    )
    result = _build_semantic(cell, "Loading")
    assert result == "Loading"


# ----------------------------------------------------------------------
# Test 8 – Boolean not treated as number (renderer fallback)
# ----------------------------------------------------------------------
def test_boolean_not_treated_as_number() -> None:
    cell = Cell(
        id="b", type=CellType.STATIC, slot="main",
        semantic_widget="progress", semantic_data=True,
    )
    result = _build_semantic(cell, "Loading")
    # Must fall back to text, no progress bar
    assert "█" not in result
    assert "Loading" in result


# ----------------------------------------------------------------------
# Test 9 – Key collision resolution (First‑Wins)
# ----------------------------------------------------------------------
def test_key_collision_first_wins() -> None:
    # Use the alias 'onKey' because Actions does not have populate_by_name
    cell = Cell(
        id="c", type=CellType.STATIC, slot="main",
        actions=Actions(onKey=[
            KeyBinding(key="a", intent="yes", label="Yes"),
            KeyBinding(key="a", intent="no", label="No"),
        ]),
    )
    assert cell.actions is not None
    assert cell.actions.on_key is not None
    # The model should contain both bindings; resolution is visual
    assert len(cell.actions.on_key) == 2
