"""Tests for layout solver module — Rounds 1, 2 & 3."""

from __future__ import annotations

import pytest
from typing import List

from core.layout.solver import (
    LayoutError,
    _SlotSpec,
    _allocate_slots_1d,
    _distribute_1d,
    solve,
)
from core.manifest.models import (
    Cell,
    CellManifest,
    CellType,
    Layout,
    Slot,
)

# ============================================================
# Round 1 tests: pure weight distribution
# ============================================================

def test_even_distribution() -> None:
    result = _distribute_1d(9, [1, 1, 1])
    assert result == [3, 3, 3]

def test_largest_remainder_method() -> None:
    result = _distribute_1d(10, [1, 1, 1])
    assert sum(result) == 10
    assert sorted(result, reverse=True) == [4, 3, 3]

def test_unequal_weights() -> None:
    result = _distribute_1d(10, [2, 1, 1])
    assert sum(result) == 10
    assert result[0] == 5

def test_single_element() -> None:
    assert _distribute_1d(80, [1]) == [80]

def test_insufficient_space() -> None:
    result = _distribute_1d(3, [1, 1, 1])
    assert sum(result) == 3
    assert all(s >= 1 for s in result)

def test_zero_space() -> None:
    assert _distribute_1d(0, [1, 1]) == [0, 0]

def test_large_weight_disparity() -> None:
    result = _distribute_1d(100, [10, 1, 1])
    assert sum(result) == 100
    assert result[0] > result[1]

def test_non_integer_ratio() -> None:
    result = _distribute_1d(10, [1, 1, 2])
    assert sum(result) == 10
    assert max(result) == 5

# ============================================================
# Round 2 tests: constraint allocation
# ============================================================

def make_slot(weight: int = 1, min_constraint: int = 2, priority: int = 50, collapse_mode: str = "scroll") -> _SlotSpec:
    """Helper to create _SlotSpec instances."""
    return _SlotSpec(weight, min_constraint, priority, collapse_mode)

def test_no_conflict_plenty_of_space() -> None:
    slots = [
        make_slot(weight=1, min_constraint=5),
        make_slot(weight=1, min_constraint=5),
    ]
    result = _allocate_slots_1d(20, slots)
    assert sum(result) == 20
    assert all(r >= 5 for r in result)

def test_partial_conflict_scroll_downgraded() -> None:
    slots = [
        make_slot(weight=1, min_constraint=10, priority=100),
        make_slot(weight=1, min_constraint=10, priority=10),
    ]
    result = _allocate_slots_1d(15, slots)
    assert sum(result) == 15
    assert result[0] >= 10
    assert result[1] == 15 - result[0]

def test_all_conflict_max_priority_wins() -> None:
    slots = [
        make_slot(weight=1, min_constraint=8, priority=100),
        make_slot(weight=1, min_constraint=8, priority=50),
    ]
    result = _allocate_slots_1d(10, slots)
    assert sum(result) == 10
    assert result[0] >= 8

def test_extreme_compression() -> None:
    slots = [
        make_slot(weight=1, min_constraint=8, priority=100),
        make_slot(weight=1, min_constraint=8, priority=50),
        make_slot(weight=1, min_constraint=8, priority=10),
    ]
    result = _allocate_slots_1d(10, slots)
    assert sum(result) == 10
    assert result[0] >= 8
    assert result[1] == 1
    assert result[2] == 1

def test_zero_space_layout_error() -> None:
    slots = [make_slot(weight=1, min_constraint=1) for _ in range(2)]
    with pytest.raises(LayoutError):
        _allocate_slots_1d(1, slots)

def test_truncate_not_needlessly_cut() -> None:
    slots = [
        _SlotSpec(weight=1, min_constraint=15, priority=1, collapse_mode="truncate"),
        _SlotSpec(weight=1, min_constraint=2, priority=1, collapse_mode="scroll"),
    ]
    result = _allocate_slots_1d(20, slots)
    assert sum(result) == 20
    assert result[0] >= 15
    assert result[1] >= 2

def test_mixed_downgrade_scroll_and_truncate() -> None:
    slots = [
        _SlotSpec(weight=1, min_constraint=10, priority=90, collapse_mode="scroll"),
        _SlotSpec(weight=1, min_constraint=10, priority=50, collapse_mode="truncate"),
    ]
    result = _allocate_slots_1d(12, slots)
    assert sum(result) == 12
    assert result[0] >= 10
    assert result[1] == 12 - result[0]

def test_equal_priority_no_bias() -> None:
    slots = [
        make_slot(weight=1, min_constraint=5, priority=50),
        make_slot(weight=1, min_constraint=5, priority=50),
    ]
    result = _allocate_slots_1d(12, slots)
    assert sum(result) == 12
    assert min(result) >= 5

# ============================================================
# Round 3 tests: nested tree coordinates
# ============================================================

def test_nested_layout_coordinates() -> None:
    """Verify coordinates of a nested horizontal/vertical layout."""
    manifest = CellManifest(
        version="2.0",
        layout=Layout(
            direction="horizontal",
            slots=[
                Slot(id="sidebar", weight=1),
                Slot(
                    id="main_area",
                    weight=3,
                    layout=Layout(
                        direction="vertical",
                        slots=[
                            Slot(id="status_bar", weight=1),
                            Slot(id="log_viewer", weight=4),
                        ],
                    ),
                ),
            ],
        ),
        cells=[
            Cell(
                id="static.title",
                type=CellType.STATIC,
                slot="sidebar",
                min_constraint={"width": 10, "height": 3},
                priority=100,
            ),
            Cell(
                id="realtime.cpu",
                type=CellType.REALTIME,
                slot="status_bar",
                min_constraint={"width": 5, "height": 1},
            ),
            Cell(
                id="dynamic.logs",
                type=CellType.DYNAMIC,
                slot="log_viewer",
                collapse_mode="scroll",
                priority=50,
            ),
        ],
    )
    view = solve(manifest, 100, 20)
    root = view.nodes[0]
    assert root.x == 0 and root.y == 0
    assert root.width == 100 and root.height == 20

    sidebar = root.children[0]
    assert sidebar.id == "static.title"
    assert sidebar.x == 0 and sidebar.width == 25
    assert sidebar.y == 0 and sidebar.height == 20

    main_area = root.children[1]
    assert main_area.x == 25 and main_area.width == 75
    assert main_area.y == 0 and main_area.height == 20

    status = main_area.children[0]
    assert status.id == "realtime.cpu"
    assert status.x == 25 and status.y == 0
    assert status.width == 75 and status.height == 4

    logs = main_area.children[1]
    assert logs.id == "dynamic.logs"
    assert logs.x == 25 and logs.y == 4
    assert logs.width == 75 and logs.height == 16
