"""Deterministic layout solver — Round 2: constraint-aware allocation."""

from collections import namedtuple
from typing import Any

from ..tree import ViewTree


class LayoutError(Exception):
    """Raised when layout constraints cannot be satisfied."""

    pass


_SlotSpec = namedtuple("_SlotSpec", ["weight", "min_constraint", "priority", "collapse_mode"])


def _distribute_1d(space: int, weights: list[int]) -> list[int]:
    """Distribute integer space proportionally by weights."""
    if not weights:
        raise LayoutError("Cannot distribute space with empty weights")
    if space < 0:
        raise LayoutError("Cannot distribute negative space")

    total_weight = sum(weights)
    if total_weight == 0:
        raise LayoutError("Total weight must be positive")

    allocated: list[int] = []
    remaining_space = space
    remaining_weight = total_weight

    for w in weights:
        if remaining_weight == 0:
            allocated.append(0)
            continue
        size = round(remaining_space * w / remaining_weight)
        size = max(0, min(remaining_space, size))
        allocated.append(size)
        remaining_space -= size
        remaining_weight -= w

    assert sum(allocated) == space, f"Sum {sum(allocated)} != {space}"
    return allocated


def _allocate_slots_1d(space: int, slots: list[_SlotSpec]) -> list[int]:
    """Allocate integer space to slots with constraints and downgrade logic.

    Implements Flexbox-style two-phase resolution adapted for discrete
    terminal grids:

    1. Downgrade loop: repeatedly compress the lowest-priority slot
       (regardless of collapse_mode) to height 1 until all current
       minimums fit within the available space. This ensures priority
       is respected across both scroll and truncate slots.
    2. Initial weight-based distribution using _distribute_1d.
    3. Freeze-correction iteration: any slot (scroll or truncate)
       receiving less than its current min_constraint is frozen at
       that minimum. Remaining space is redistributed among unfrozen
       slots. Repeats until no new slots are frozen.

    Only raises LayoutError when even 1 unit per slot cannot be
    satisfied (Panic Mode exhaustion).

    Args:
        space: Available integer space (columns or rows).
        slots: List of _SlotSpec defining each slot's constraints.

    Returns:
        List of allocated sizes, one per slot. Sum equals space.

    Raises:
        LayoutError: If space is smaller than the number of slots.
    """
    n = len(slots)
    if space < n:
        raise LayoutError(
            f"Terminal too small: space={space}, slots={n}. Each slot needs at least 1 unit."
        )

    # Phase 1: Downgrade loop — compress by ascending priority
    current_mins = [s.min_constraint for s in slots]

    while sum(current_mins) > space:
        candidates = [i for i in range(n) if current_mins[i] > 1]
        if not candidates:
            break
        i = min(candidates, key=lambda idx: (slots[idx].priority, idx))
        current_mins[i] = 1

    if sum(current_mins) > space:
        raise LayoutError(
            f"Terminal too small after full downgrade: space={space}, min_sum={sum(current_mins)}"
        )

    # Phase 2 & 3: initial distribution and freeze-correction
    unfrozen = set(range(n))
    final_alloc = [0] * n

    while True:
        frozen_sum = sum(final_alloc[i] for i in range(n) if i not in unfrozen)
        remaining_space = space - frozen_sum
        unfrozen_weights = [slots[i].weight for i in unfrozen]
        unfrozen_indices = list(unfrozen)

        if not unfrozen_indices:
            break

        temp_alloc = _distribute_1d(remaining_space, unfrozen_weights)

        newly_frozen = False
        for idx, temp_val in zip(unfrozen_indices, temp_alloc, strict=True):
            if temp_val < current_mins[idx]:
                final_alloc[idx] = current_mins[idx]
                unfrozen.remove(idx)
                newly_frozen = True

        if not newly_frozen:
            for idx, temp_val in zip(unfrozen_indices, temp_alloc, strict=True):
                final_alloc[idx] = temp_val
            break

    assert sum(final_alloc) == space, f"Sum {sum(final_alloc)} != {space}"
    return final_alloc


def solve(
    *args: Any,
    **kwargs: Any,
) -> ViewTree:
    """Placeholder for recursive tree solver (Round 3).

    Args:
        *args: Forwarded to future solver implementation.
        **kwargs: Forwarded to future solver implementation.

    Returns:
        An empty ViewTree.
    """
    return ViewTree(nodes=[])
