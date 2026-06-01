# Cellrix AI & Developer Design Guidelines v1.0

This document serves as the ground-truth design specification and AI prompting instruction for Cellrix. All code generation, refactoring, and AI-assisted PR reviews MUST strictly align with the principles detailed below.

---

## 1. Core Architectural Pillars

### Pillar A: Immutable Decoupling (The Crate Boundaries)
- **`cellrix-protocol`**: ZERO dependency. Pure mathematics, JSON and MessagePack serializations. It MUST be able to compile to WebAssembly (WASM) out of the box to support future WebUI revolutions.
- **`cellrix-layout`**: Pure mathematical spatial solver. It only knows `LayoutRect` and coordinate geometry. It MUST NOT import any terminal UI crates (like `ratatui` or `crossterm`).
- **`cellrix-ui`**: The dumb projection and rendering layer. It consumes `cellrix-layout` outputs and translates them into terminal buffer cells.

### Pillar B: Somatic Monasticism (The Aesthetic Philosophy)
- **Volcano Base Color**: `#18181A` (RGB: 24, 24, 26).
- **Somatic Indigo Highlight**: `#5B5FC7` (RGB: 91, 95, 199).
- **Slate Gray secondary**: `#71717A` (RGB: 113, 113, 122).
- **Amber Warning**: `#D08770` (RGB: 208, 135, 112).
- Colors MUST only represent system and interaction states, NEVER decorative elements.
- Layout scaling is equivalent to spacing density (Balanced, Compact, Spacious) rather than pixel font size.

---

## 2. Interaction & Keyboard Manifesto

All keybindings must respect professional developer habits (Vim, Tmux, Claude Code, and Nano).

1. **Focus Cycling**:
   - `Tab`: Cycle focus forward through ALL visible, interactive nodes (Sidebar -> Main -> Bottom -> Sidebar).
   - `Shift+Tab`: Cycle focus backward.
2. **Tab switching**:
   - `Alt+Left` / `Alt+Right` (equivalent to Mac `Option+Left/Right`): Cycle between tabbed active nodes inside a single slot.
3. **Zen Mode**:
   - `Ctrl+O` (aligned with Nano): Expand the focused node's slot weight to 100% and collapse others to 0%. Press `Ctrl+O` again to restore. Single-character keys (like `z`) are discouraged in editing contexts to prevent input collision.
4. **Clean Mouse Copy-Paste**:
   - Normal drag-select is reserved for the terminal emulator's native OS copy-paste (Shift + Drag is universally supported as native bypass).
   - `Alt/Opt + Drag`: Triggers Cellrix's high-precision spatial `MouseSelector`, performing clean, zero-pollution semantic text extraction (bypassing window borders and cross-column mixture) and writing it to the system clipboard via `arboard`.
5. **Redraw Command**:
   - `Ctrl+L`: Redraw the whole screen to clear ghost shadows.

---

## 3. Strict Safety & Robustness Guarantees (The Google standard)

- **Zero Panic Parser**:
  - The `parse_snapshot_gracefully` function MUST NOT panic under any malformed, corrupted, or malicious payload.
  - A maximum limit of 256 nodes per snapshot and 1MB content size per node must be strictly enforced.
- **Hermetic Hermit Tests**:
  - All integration tests under `tests/` and crate-level `tests/*_test.rs` must be hermetic. No network I/O, no reliance on global system states.
