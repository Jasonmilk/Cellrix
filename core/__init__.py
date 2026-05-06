"""Cellrix Core - protocol engine for deterministic terminal UIs."""

from .tree import ViewTree, SemanticTree
from .layout.solver import solve
from .source import SourceManager

__all__ = ["ViewTree", "SemanticTree", "solve", "SourceManager"]
