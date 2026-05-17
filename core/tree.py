"""Data structures for the Cellrix ViewTree and SemanticTree."""

from __future__ import annotations
from typing import Any

from dataclasses import dataclass, field


@dataclass
class Node:
    """A node in the ViewTree (spatial) and SemanticTree (semantic)."""

    id: str
    x: int = 0
    y: int = 0
    width: int = 0
    height: int = 0
    children: list[Node] = field(default_factory=list)
    role: str = ""
    summary: str = ""
    content: str = ""
    semantic_widget: str | None = None
    semantic_data: Any | None = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "x": self.x,
            "y": self.y,
            "width": self.width,
            "height": self.height,
            "children": [child.to_dict() for child in self.children],
            "role": self.role,
            "summary": self.summary,
            "content": self.content,
            "semantic_widget": self.semantic_widget,
            "semantic_data": self.semantic_data,
        }


@dataclass
class ViewTree:
    """The spatial render tree. A tree of Nodes with absolute coordinates."""

    nodes: list[Node] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {"nodes": [node.to_dict() for node in self.nodes]}


@dataclass
class SemanticTree:
    """The semantic tree. A tree of Nodes with semantic metadata."""

    nodes: list[Node] = field(default_factory=list)
