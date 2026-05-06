"""Source manager for dynamic and realtime Cell data binding.

Uses daemon threads and thread‑safe queues to read subprocess output
without blocking the main UI thread.  Works cross‑platform including
Windows (where `select` does not support pipes).
"""

from __future__ import annotations

import subprocess
import threading
from queue import Empty, Queue
from typing import Dict, Optional

from .manifest.models import Cell


class _PipeReader:
    """Reads lines from a subprocess pipe and feeds them into a queue."""

    def __init__(self, command: str) -> None:
        self.command = command
        self._queue: Queue[str] = Queue()
        self._process: Optional[subprocess.Popen[str]] = None
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

    def start(self) -> None:
        """Launch the subprocess and start the reader thread."""
        self._process = subprocess.Popen(
            self.command,
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        self._thread = threading.Thread(target=self._read_loop, daemon=True)
        self._thread.start()

    def _read_loop(self) -> None:
        """Continuously read lines from the subprocess stdout."""
        try:
            assert self._process is not None and self._process.stdout is not None
            for line in self._process.stdout:
                if self._stop_event.is_set():
                    break
                self._queue.put(line)
        except (ValueError, OSError):
            # Pipe closed or process terminated
            pass

    def poll(self, mode: str = "realtime") -> Optional[str]:
        """Return the latest content according to `mode`.

        - `realtime`: discard all buffered lines except the last one.
        - `dynamic`: join all buffered lines (newline separated).
        """
        lines: list[str] = []
        while True:
            try:
                lines.append(self._queue.get_nowait())
            except Empty:
                break

        if not lines:
            return None

        if mode == "realtime":
            return lines[-1].strip()
        # dynamic – append
        return "".join(lines).strip()

    def stop(self) -> None:
        """Signal the thread to stop and terminate the subprocess."""
        self._stop_event.set()
        if self._process and self._process.poll() is None:
            self._process.terminate()
            try:
                self._process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                self._process.kill()


class SourceManager:
    """Manages a collection of _PipeReader instances keyed by cell id."""

    def __init__(self) -> None:
        self._readers: Dict[str, _PipeReader] = {}

    def add_cell(self, cell: Cell) -> None:
        """Add a cell that has a pipe source."""
        if cell.source is None or cell.source.type != "pipe" or cell.source.command is None:
            return
        reader = _PipeReader(cell.source.command)
        reader.start()
        self._readers[cell.id] = reader

    def poll_all(self) -> Dict[str, str]:
        """Poll all managed cells and return updated content keyed by cell id.

        The returned dictionary only contains cells whose content actually changed.
        """
        updates: Dict[str, str] = {}
        for cell_id, reader in self._readers.items():
            mode = "realtime"  # default – can be overridden later
            new_content = reader.poll(mode=mode)
            if new_content is not None:
                updates[cell_id] = new_content
        return updates

    def shutdown(self) -> None:
        """Stop all running pipe readers."""
        for reader in self._readers.values():
            reader.stop()
        self._readers.clear()
