"""Deterministic layout solver — Round 1: pure weight distribution."""


class LayoutError(Exception):
    """Raised when layout constraints cannot be satisfied."""
    pass


def _distribute_1d(space: int, weights: list[int]) -> list[int]:
    """Distribute integer space proportionally by weights.

    Uses dynamic remainder absorption to ensure the sum of
    allocated sizes equals the given space exactly.

    Args:
        space: Total integer space to distribute.
        weights: List of positive integer weights.

    Returns:
        List of allocated sizes, same length as weights.
        Sum of returned list equals space.

    Raises:
        LayoutError: If weights are empty or space is negative.
    """
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
        # Dynamic allocation absorbs rounding errors naturally
        size = round(remaining_space * w / remaining_weight)
        # Clamp to [0, remaining_space]
        size = max(0, min(remaining_space, size))
        allocated.append(size)
        remaining_space -= size
        remaining_weight -= w

    # Guarantee: sum(allocated) == space
    assert sum(allocated) == space, f"Sum {sum(allocated)} != {space}"
    return allocated
