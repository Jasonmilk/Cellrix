"""Runner for cellrix-textual: spawns a subprocess, reads its Manifest output,
renders it as a Textual App, and writes user actions back to the subprocess.

Conforms to Cellrix Zen:
- Orchestrate: delegates rendering to Textual, only manages pipes.
- Strict contracts: uses standard Cellrix Action JSON format (CIS §8).
- Pure streams: stdout for actions, stderr for diagnostics.
- Radical simplicity: no unnecessary abstractions.
"""

from __future__ import annotations

import json
import subprocess
import threading
from typing import Optional

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical, ScrollableContainer, Center
from textual.screen import ModalScreen
from textual.widgets import Static, Label, Button

from core.manifest.parser import parse_manifest
from core.manifest.models import CellManifest


class HelpScreen(ModalScreen):
    """Full‑screen help overlay."""
    BINDINGS = [Binding("escape", "dismiss", "Close")]
    def compose(self) -> ComposeResult:
        with Vertical():
            with ScrollableContainer():
                yield Label("Shortcuts:\n  q=Quit  Tab=Next  Shift+Tab=Prev  F1=Help")
            with Center():
                yield Button("Close", variant="primary", action="dismiss")


class RunnerApp(App):
    """Textual app that reads Manifest from a subprocess and writes actions back.

    The subprocess must emit one line of JSON Manifest per update and read
    Cellrix Action JSON from its stdin.  All output must be flushed
    immediately and contain no embedded newlines.
    """

    CSS = """
    Screen { align: center top; }
    Horizontal { width: 100%; height: 100%; }
    Vertical { width: 100%; height: 100%; }
    .cell { border: solid $panel; padding: 0 1; width: 1fr; height: 100%; }
    .cell:focus { border: solid $success; }
    """

    BINDINGS = [
        Binding("q", "emit_quit", "Quit"),
        Binding("tab", "emit_focus_next", "Next", show=False),
        Binding("shift+tab", "emit_focus_prev", "Prev", show=False),
        Binding("f1", "emit_help", "Help"),
    ]

    def __init__(self, command: list[str], strict: bool = False):
        super().__init__()
        self.command = command
        self.strict = strict
        self.manifest: Optional[CellManifest] = None
        self.process: Optional[subprocess.Popen] = None
        self._stop_reader = threading.Event()

    def on_mount(self) -> None:
        """Start subprocess and background reader thread."""
        try:
            self.process = subprocess.Popen(
                self.command,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,          # line buffering is critical
            )
        except Exception as e:
            self.notify(f"Failed to start process: {e}", severity="error", timeout=5)
            self.set_timer(3, self.exit)
            return

        # No blocking reads on main thread — everything goes through the daemon
        self._reader_thread = threading.Thread(target=self._read_manifests, daemon=True)
        self._reader_thread.start()

    def _read_manifests(self) -> None:
        """Background thread: continuously read manifest lines from subprocess."""
        if self.process is None or self.process.stdout is None:
            return

        try:
            while not self._stop_reader.is_set():
                line = self.process.stdout.readline()
                if not line:
                    break          # EOF – subprocess exited or closed stdout
                line = line.strip()
                if line:
                    # Schedule UI update on the main thread (thread‑safe)
                    self.call_from_thread(self._apply_manifest, line)
        except Exception:
            pass
        finally:
            # Notify main thread about subprocess exit
            if not self._stop_reader.is_set():
                self.call_from_thread(self._handle_process_exit)

    def _handle_process_exit(self) -> None:
        """Handle natural subprocess termination."""
        self.notify("Subprocess exited. Closing Textual App...", timeout=2)
        self.set_timer(1.5, self.exit)

    def _apply_manifest(self, raw: str) -> None:
        """Parse a manifest line and rebuild the widget tree (main thread)."""
        try:
            manifest = parse_manifest(raw, strict=self.strict)
            self.manifest = manifest

            # Full rebuild – future optimization: diff & update
            self.query(".cell").remove()
            new_layout = self._build_layout(manifest)
            self.mount(new_layout)

        except Exception as e:
            self.notify(f"Malformed manifest: {e}", severity="warning")

    def _build_layout(self, manifest: CellManifest):
        """Recursively build a layout container from a Cell‑Manifest."""
        slot_cells: dict[str, list] = {}
        for cell in manifest.cells:
            slot_cells.setdefault(cell.slot, []).append(cell)

        children = []
        for slot in manifest.layout.slots:
            if slot.layout is not None:
                sub = CellManifest(
                    version=manifest.version,
                    layout=slot.layout,
                    cells=[
                        c for c in manifest.cells
                        if c.slot in {s.id for s in slot.layout.slots}
                    ],
                )
                children.append(self._build_layout(sub))
            else:
                cell = slot_cells.get(slot.id, [None])[0]
                w = (
                    Static(cell.content or cell.id, classes="cell")
                    if cell else Static("")
                )
                w.can_focus = True
                children.append(w)

        if manifest.layout.direction == "horizontal":
            return Horizontal(*children)
        return Vertical(*children)

    # ── Action emission ──────────────────────────────────────────────────
    def _send_action(self, action: str, cell_id: str = "", payload: dict | None = None) -> None:
        """Write a standard Cellrix Action JSON line to the subprocess."""
        if self.process and self.process.stdin and self.process.poll() is None:
            msg = {
                "event": "cellrix.action",
                "action": action,
                "cell_id": cell_id,
                "payload": payload or {},
            }
            try:
                self.process.stdin.write(json.dumps(msg) + "\n")
                self.process.stdin.flush()
            except BrokenPipeError:
                pass

    def action_emit_quit(self) -> None:
        self._send_action("quit")
        self.exit()

    def action_emit_focus_next(self) -> None:
        self._send_action("focus_next")
        self.focus_next()

    def action_emit_focus_prev(self) -> None:
        self._send_action("focus_prev")
        self.focus_previous()

    def action_emit_help(self) -> None:
        self._send_action("toggle_help")
        self.push_screen(HelpScreen())

    def on_unmount(self) -> None:
        """Clean up subprocess resources."""
        self._stop_reader.set()
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                self.process.kill()


def run_cellrix(command: list[str], strict: bool = False) -> None:
    """Entry point for `cellrix run`."""
    app = RunnerApp(command, strict=strict)
    app.run()
