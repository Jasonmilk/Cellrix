"""Tests for layout solver module — Round 1: pure weight distribution."""

import pytest
from core.layout.solver import LayoutError, _distribute_1d


def test_even_distribution():
    """Total space 9, weights [1,1,1] → [3,3,3]."""
    result = _distribute_1d(9, [1, 1, 1])
    assert result == [3, 3, 3]


def test_largest_remainder_method():
    """Total space 10, weights [1,1,1] → Largest remainder gives [4,3,3]."""
    result = _distribute_1d(10, [1, 1, 1])
    assert sum(result) == 10
    assert sorted(result, reverse=True) == [4, 3, 3]


def test_unequal_weights():
    """Total space 10, weights [2,1,1] → [5,3,2] or [5,2,3]."""
    result = _distribute_1d(10, [2, 1, 1])
    assert sum(result) == 10
    assert result[0] == 5  # highest weight gets the largest share


def test_single_element():
    """Total space 80, single weight → all space to it."""
    assert _distribute_1d(80, [1]) == [80]


def test_insufficient_space():
    """Total space 3, three weights → each gets 1."""
    result = _distribute_1d(3, [1, 1, 1])
    assert sum(result) == 3
    assert all(s >= 1 for s in result)


def test_zero_space():
    """Total space 0 → all zeros."""
    assert _distribute_1d(0, [1, 1]) == [0, 0]


def test_large_weight_disparity():
    """Total space 100, weights [10,1,1] → [84,8,8]."""
    result = _distribute_1d(100, [10, 1, 1])
    assert sum(result) == 100
    assert result[0] > result[1]  # high weight dominates


def test_non_integer_ratio():
    """Total space 10, weights [1,1,2] → [3,2,5]."""
    result = _distribute_1d(10, [1, 1, 2])
    assert sum(result) == 10
    assert max(result) == 5  # weight 2 gets half
