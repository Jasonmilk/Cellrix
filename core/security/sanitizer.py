# core/security/sanitizer.py
"""Strip ANSI escape sequences from external input."""

import re


class SecurityError(Exception):
    """Security violation error."""
    pass


# Matches CSI, OSC (BEL or ST terminated), and DCS/PM/APC sequences
_ANSI_PATTERN = re.compile(
    r'\x1b\[[0-9;]*[A-Za-z]'       # CSI sequences
    r'|\x1b\].*?(?:\x07|\x1b\\)'   # OSC (BEL or ST terminator)
    r'|\x1b[PX^_].*?\x1b\\'        # DCS, SOS, PM, APC
)

def sanitize(text: str) -> str:
    """Remove any ANSI escape sequences.

    Args:
        text: Raw string possibly containing control chars.

    Returns:
        Clean string with sequences stripped.

    Raises:
        SecurityError: If sequences were found and removed.
    """
    cleaned = _ANSI_PATTERN.sub('', text)
    if cleaned != text:
        raise SecurityError("ANSI escape sequences detected and removed")
    return cleaned