"""Abstract tree structures shared across Core."""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Node:
    """A single node in a ViewTree or SemanticTree."""

    id: str
    x: int = 0
    y: int = 0
    width: int = 0
    height: int = 0
    children: list["Node"] = field(default_factory=list)
    role: str | None = None
    summary: str | None = None
    content: str | None = None  # Cell content from Manifest


@dataclass
class ViewTree:
    """Render Tree with physical coordinates for terminal rendering."""

    nodes: list[Node] = field(default_factory=list)


@dataclass
class SemanticTree:
    """Semantic Tree stripped of coordinates, exposed to AI and screen readers."""

    nodes: list[Node] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
