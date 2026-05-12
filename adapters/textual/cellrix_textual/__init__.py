"""Cellrix Textual adapter – renders a Cell-Manifest as a full-screen Textual app."""

__all__ = ["TextualCellrixApp"]

def __getattr__(name):
    if name == "TextualCellrixApp":
        from .app import TextualCellrixApp
        return TextualCellrixApp
    raise AttributeError(name)
