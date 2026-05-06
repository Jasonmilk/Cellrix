"""Minimal non-blocking keyboard input reader.

Uses only the Python standard library. On Unix, uses raw mode briefly;
on Windows, uses msvcrt. Degrades gracefully when stdin is not a TTY.
"""

from __future__ import annotations

import sys
from typing import Any, Callable, Optional


def _noop_get_key(timeout: float = 0.0) -> Optional[str]:
    return None


if sys.platform == "win32" and sys.stdin.isatty():
    import msvcrt
    import time as _time

    def _windows_get_key(timeout: float = 0.0) -> Optional[str]:
        start = _time.time()
        while True:
            if msvcrt.kbhit():
                char = msvcrt.getch()
                if char in (b"\x00", b"\xe0"):
                    if msvcrt.kbhit():
                        nxt = msvcrt.getch()
                        if nxt == b";":
                            return "f1"
                        elif nxt == b"\x0f":
                            return "shift+tab"
                elif char == b"\t":
                    return "tab"
                elif char in (b"\r", b"\n"):
                    return "enter"
                elif char.isalpha() or char.isdigit():
                    return char.decode("ascii", "ignore").lower()
                return None
            if _time.time() - start >= timeout:
                return None
            _time.sleep(0.005)

elif sys.stdin.isatty():
    import os
    import select
    import termios
    import tty

    def _unix_get_key(timeout: float = 0.0) -> Optional[str]:
        rlist, _, _ = select.select([sys.stdin], [], [], timeout)
        if not rlist:
            return None

        fd = sys.stdin.fileno()
        old_settings = termios.tcgetattr(fd)
        try:
            tty.setraw(fd)
            raw = os.read(fd, 1)
            if not raw:
                return None
            first_byte = raw[0]

            if first_byte == 0x1B:
                seq = b"\x1b"
                while True:
                    r, _, _ = select.select([sys.stdin], [], [], 0)
                    if not r:
                        break
                    char = os.read(fd, 1)
                    if not char:
                        break
                    seq += char
                    if char.isalpha() or char == b"~":
                        break
                seq_str = seq.decode("utf-8", errors="ignore")
                if seq_str in ("\x1bOP", "\x1b[11~", "\x1b[[A", "\x1bOQ"):
                    return "f1"
                if seq_str == "\x1b[Z":
                    return "shift+tab"
                if seq_str == "\x1b":
                    return "escape"
                return None

            if first_byte == 0x09:
                return "tab"
            if first_byte in (0x0D, 0x0A):
                return "enter"
            if first_byte == 0x7F:
                return "backspace"
            if 0x20 <= first_byte <= 0x7E:
                return chr(first_byte).lower()
            return None
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)

else:
    _unix_get_key = _noop_get_key   # not a TTY, no input possible


class KeyReader:
    """Unified keyboard reader that works cross‑platform and degrades gracefully."""

    def __init__(self) -> None:
        if not sys.stdin.isatty():
            self._read: Callable[[float], Optional[str]] = _noop_get_key
        elif sys.platform == "win32":
            self._read = _windows_get_key
        else:
            self._read = _unix_get_key

    def get_key(self, timeout: float = 0.0) -> Optional[str]:
        """Return the next key press or None."""
        return self._read(timeout)
