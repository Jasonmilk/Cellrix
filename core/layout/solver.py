"""Deterministic layout solver."""

from ..manifest.models import CellManifest
from ..tree import ViewTree


class LayoutError(Exception):
    """Raised when layout constraints cannot be satisfied."""

    pass


def solve(manifest: CellManifest, terminal_width: int, terminal_height: int) -> ViewTree:
    """Compute layout coordinates.

    Pure function. O(N) time, backtracking-free.

    Args:
        manifest: Validated manifest.
        terminal_width: Available columns.
        terminal_height: Available rows.

    Returns:
        ViewTree with physical coordinates.

    Raises:
        LayoutError: If min constraints exceed available space.
    """
    # TODO: Implement weight-based recursive allocation.
    # Placeholder returns empty tree.
    _ = (manifest, terminal_width, terminal_height)
    return ViewTree(nodes=[])
