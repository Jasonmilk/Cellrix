"""Theme definition for Cellrix CLI.

Colors and styles are stored as plain data. The default dark theme
is always available. Future versions may load custom themes from disk,
but for now simplicity rules.
"""

from dataclasses import dataclass
from rich.style import Style


@dataclass(frozen=True)
class Theme:
    """Theme values consumed by the renderer."""
    # ----- panel / border colors -----
    border_style: str = "dim"
    focused_border_style: str = "bold green"
    help_border_style: str = "yellow"
    status_border_style: str = "yellow"

    # ----- text -----
    text_style: Style = Style(color="white")
    help_text_style: Style = Style(color="white")

    # ----- backgrounds (must be "default" for transparency) -----
    panel_bg: str = "default"


DEFAULT_THEME = Theme()
