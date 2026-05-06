"""Deterministic layout solver — Round 3: tree‐aware recursive solver."""

from collections import namedtuple

from ..manifest.models import Cell, CellManifest, Layout, Slot
from ..tree import Node, ViewTree


class LayoutError(Exception):
    """Raised when layout constraints cannot be satisfied."""

    pass


# Named tuple for slot specifications — minimal, no class overhead.
_SlotSpec = namedtuple(
    "_SlotSpec",
    ["weight", "min_constraint", "priority", "collapse_mode"],
)


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
       minimums fit within the available space.
    2. Initial weight-based distribution using _distribute_1d.
    3. Freeze-correction iteration: any slot receiving less than its
       current min_constraint is frozen at that minimum. Remaining space
       is redistributed among unfrozen slots.

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


def _measure_slot(
    slot: Slot,
    cell_map: dict[str, Cell],
) -> tuple[int, int, int]:
    """Compute the intrinsic minimum dimensions and effective priority of a slot.

    If the slot contains a nested layout, the minima are aggregated
    from its children according to the layout direction. Priority bubbles
    up as the maximum priority among all descendant cells.

    Args:
        slot: The Slot to measure.
        cell_map: Mapping from slot IDs to their bound Cell objects.

    Returns:
        A tuple of (min_width, min_height, effective_priority).
    """
    if slot.layout is not None:
        child_mins = [_measure_slot(child_slot, cell_map) for child_slot in slot.layout.slots]
        if slot.layout.direction == "horizontal":
            min_w = sum(m[0] for m in child_mins)
            min_h = max(m[1] for m in child_mins)
        else:  # vertical
            min_w = max(m[0] for m in child_mins)
            min_h = sum(m[1] for m in child_mins)
        eff_priority = max(m[2] for m in child_mins)
        return (min_w, min_h, eff_priority)

    if slot.id in cell_map:
        cell = cell_map[slot.id]
        if cell.min_constraint is not None:
            w = cell.min_constraint.get("width", 1)
            h = cell.min_constraint.get("height", 1)
        else:
            w, h = 1, 1
        return (w, h, cell.priority)

    # Empty slot without a cell — minimal fallback
    return (1, 1, 0)


def _layout_tree(
    layout: Layout,
    cell_map: dict[str, Cell],
    x: int,
    y: int,
    w: int,
    h: int,
) -> Node:
    """Recursively compute positions for all slots and cells.

    Args:
        layout: The current Layout node.
        cell_map: Mapping from slot IDs to their bound Cell objects.
        x, y: Top-left coordinate of the available region.
        w, h: Size of the available region.

    Returns:
        A Node representing the root of the layout tree at this level.
    """
    direction = layout.direction
    space = w if direction == "horizontal" else h

    # Build slot specifications using measured minima and priorities
    specs: list[_SlotSpec] = []
    for slot in layout.slots:
        min_w, min_h, eff_priority = _measure_slot(slot, cell_map)
        min_constraint = min_w if direction == "horizontal" else min_h
        # Determine collapse mode from the bound cell, if any
        collapse_mode = "scroll"  # default
        if slot.id in cell_map:
            collapse_mode = cell_map[slot.id].collapse_mode or "scroll"

        specs.append(
            _SlotSpec(
                weight=slot.weight,
                min_constraint=min_constraint,
                priority=eff_priority,
                collapse_mode=collapse_mode,
            )
        )

    sizes = _allocate_slots_1d(space, specs)

    # Build child nodes and track coordinates
    child_nodes: list[Node] = []
    offset = x if direction == "horizontal" else y

    for i, slot in enumerate(layout.slots):
        size = sizes[i]

        if direction == "horizontal":
            slot_x, slot_y = offset, y
            slot_w, slot_h = size, h
            offset += size
        else:
            slot_x, slot_y = x, offset
            slot_w, slot_h = w, size
            offset += size

        # Ensure reasonable minima
        slot_w = max(1, slot_w)
        slot_h = max(1, slot_h)

        if slot.id in cell_map:
            child = Node(
                id=cell_map[slot.id].id,
                x=slot_x,
                y=slot_y,
                width=slot_w,
                height=slot_h,
            )
            child_nodes.append(child)
        elif slot.layout is not None:
            child = _layout_tree(
                slot.layout,
                cell_map,
                slot_x,
                slot_y,
                slot_w,
                slot_h,
            )
            child_nodes.append(child)
        else:
            # Empty slot without cell or nested layout — create placeholder
            child_nodes.append(
                Node(
                    id=slot.id,
                    x=slot_x,
                    y=slot_y,
                    width=slot_w,
                    height=slot_h,
                )
            )

    # Wrap children in a container node
    root = Node(
        id="container",
        x=x,
        y=y,
        width=w,
        height=h,
        children=child_nodes,
    )
    return root


def solve(
    manifest: CellManifest,
    terminal_width: int,
    terminal_height: int,
) -> ViewTree:
    """Main entry point for layout solving.

    Args:
        manifest: Parsed and validated Cell-Manifest.
        terminal_width: Available terminal columns.
        terminal_height: Available terminal rows.

    Returns:
        A fully computed ViewTree ready for rendering.
    """
    cell_map: dict[str, Cell] = {cell.slot: cell for cell in manifest.cells}
    root_node = _layout_tree(
        manifest.layout,
        cell_map,
        0,
        0,
        terminal_width,
        terminal_height,
    )
    return ViewTree(nodes=[root_node])
