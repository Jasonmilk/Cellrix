"""Cellrix Core - protocol engine for deterministic terminal UIs."""

from .layout.solver import solve
from .tree import SemanticTree, ViewTree

__all__ = ["ViewTree", "SemanticTree", "solve"]
