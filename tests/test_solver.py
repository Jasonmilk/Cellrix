"""Tests for layout solver module — Rounds 1 & 2."""

import pytest

from core.layout.solver import (
    LayoutError,
    _allocate_slots_1d,
    _distribute_1d,
    _SlotSpec,
)

# ============================================================
# Round 1 tests: pure weight distribution
# ============================================================


def test_even_distribution():
    result = _distribute_1d(9, [1, 1, 1])
    assert result == [3, 3, 3]


def test_largest_remainder_method():
    result = _distribute_1d(10, [1, 1, 1])
    assert sum(result) == 10
    assert sorted(result, reverse=True) == [4, 3, 3]


def test_unequal_weights():
    result = _distribute_1d(10, [2, 1, 1])
    assert sum(result) == 10
    assert result[0] == 5


def test_single_element():
    assert _distribute_1d(80, [1]) == [80]


def test_insufficient_space():
    result = _distribute_1d(3, [1, 1, 1])
    assert sum(result) == 3
    assert all(s >= 1 for s in result)


def test_zero_space():
    assert _distribute_1d(0, [1, 1]) == [0, 0]


def test_large_weight_disparity():
    result = _distribute_1d(100, [10, 1, 1])
    assert sum(result) == 100
    assert result[0] > result[1]


def test_non_integer_ratio():
    result = _distribute_1d(10, [1, 1, 2])
    assert sum(result) == 10
    assert max(result) == 5


# ============================================================
# Round 2 tests: constraint allocation
# ============================================================


def make_slot(weight=1, min_constraint=2, priority=50, collapse_mode="scroll"):
    """Helper to create _SlotSpec instances."""
    return _SlotSpec(weight, min_constraint, priority, collapse_mode)


def test_no_conflict_plenty_of_space():
    """All slots comfortably above their minimums."""
    slots = [
        make_slot(weight=1, min_constraint=5),
        make_slot(weight=1, min_constraint=5),
    ]
    result = _allocate_slots_1d(20, slots)
    assert sum(result) == 20
    assert all(r >= 5 for r in result)


def test_partial_conflict_scroll_downgraded():
    """Low-priority scroll slot has its min reduced to 1, but may get leftover space."""
    slots = [
        make_slot(weight=1, min_constraint=10, priority=100, collapse_mode="scroll"),
        make_slot(weight=1, min_constraint=10, priority=10, collapse_mode="scroll"),
    ]
    result = _allocate_slots_1d(15, slots)
    assert sum(result) == 15
    assert result[0] >= 10  # high priority keeps its min
    # low priority slot gets whatever space remains after satisfying high prio min
    assert result[1] == 15 - result[0]


def test_all_conflict_max_priority_wins():
    """Only the highest-priority slot keeps its min, others fold."""
    slots = [
        make_slot(weight=1, min_constraint=8, priority=100, collapse_mode="scroll"),
        make_slot(weight=1, min_constraint=8, priority=50, collapse_mode="scroll"),
    ]
    result = _allocate_slots_1d(10, slots)
    assert sum(result) == 10
    assert result[0] >= 8
    assert result[1] == 10 - result[0]


def test_extreme_compression():
    """Only enough space for the highest-priority slot."""
    slots = [
        make_slot(weight=1, min_constraint=8, priority=100, collapse_mode="scroll"),
        make_slot(weight=1, min_constraint=8, priority=50, collapse_mode="scroll"),
        make_slot(weight=1, min_constraint=8, priority=10, collapse_mode="scroll"),
    ]
    result = _allocate_slots_1d(10, slots)
    assert sum(result) == 10
    assert result[0] >= 8  # highest priority keeps its min
    assert result[1] == 1  # remaining two compressed to at least 1
    assert result[2] == 1


def test_zero_space_layout_error():
    """Space too small even for 1 unit per slot."""
    slots = [
        make_slot(weight=1, min_constraint=1),
        make_slot(weight=1, min_constraint=1),
    ]
    with pytest.raises(LayoutError):
        _allocate_slots_1d(1, slots)


def test_truncate_not_needlessly_cut():
    """Truncate slot must be satisfied when space is available (bug fix)."""
    slots = [
        _SlotSpec(weight=1, min_constraint=15, priority=1, collapse_mode="truncate"),
        _SlotSpec(weight=1, min_constraint=2, priority=1, collapse_mode="scroll"),
    ]
    result = _allocate_slots_1d(20, slots)
    assert sum(result) == 20
    assert result[0] >= 15  # not needlessly truncated
    assert result[1] >= 2


def test_mixed_downgrade_scroll_and_truncate():
    """Lower-priority truncate compresses first, sparing higher-priority scroll."""
    slots = [
        _SlotSpec(weight=1, min_constraint=10, priority=90, collapse_mode="scroll"),
        _SlotSpec(weight=1, min_constraint=10, priority=50, collapse_mode="truncate"),
    ]
    result = _allocate_slots_1d(12, slots)
    assert sum(result) == 12
    # Higher priority scroll survives with its min
    assert result[0] >= 10
    # Lower priority truncate gets the rest
    assert result[1] == 12 - result[0]


def test_equal_priority_no_bias():
    """Equal priority slots with same constraint share space fairly."""
    slots = [
        make_slot(weight=1, min_constraint=5, priority=50),
        make_slot(weight=1, min_constraint=5, priority=50),
    ]
    result = _allocate_slots_1d(12, slots)
    assert sum(result) == 12
    assert min(result) >= 5
