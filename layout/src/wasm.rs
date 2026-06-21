// layout/src/wasm.rs
//! WebAssembly bindings for the Cellrix layout solver.
//! 
//! Exposes a pure, stateless mathematical projection: Snapshot -> LayoutOutput.

use wasm_bindgen::prelude::*;
use cellrix_protocol::SemanticSnapshot;
use crate::{LayoutEngine, LayoutRequest, LayoutOutput, LayoutConfig};

/// Symmetrical WASM boundary. Accepts raw JS Object of SemanticSnapshot,
/// executes high-performance layout computations natively in WASM, 
/// and returns the structured LayoutOutput back to WebGL/R3F as a JS Object.
#[wasm_bindgen]
pub fn compute_layout(
    js_snapshot: JsValue,
    terminal_width: u16,
    terminal_height: u16,
) -> Result<JsValue, JsValue> {
    // 1. Zero-copy deserialization from JS Object to Rust SemanticSnapshot structure
    let snapshot: SemanticSnapshot = serde_wasm_bindgen::from_value(js_snapshot)
        .map_err(|e| JsValue::from_str(&format!("Snapshot deserialization failed: {}", e)))?;

    // 2. Build the LayoutRequest matching our native TUI constraints.
    //    Zero-hardcoding: we supply LayoutConfig::default() dynamically.
    let req = LayoutRequest {
        snapshot,
        manifest: None,
        terminal_width,
        terminal_height,
        zen_focus_node_id: None,
        active_overrides: std::collections::HashMap::new(),
        config: LayoutConfig::default(),
    };

    // 3. Execute the high-performance Rust layout engine
    let mut engine = LayoutEngine::new();
    let output: LayoutOutput = engine.compute(&req)
        .map_err(|e| JsValue::from_str(&format!("Layout calculation failed: {}", e)))?;

    // 4. Serialize the LayoutOutput back into a lightweight JS Object
    let js_output = serde_wasm_bindgen::to_value(&output)
        .map_err(|e| JsValue::from_str(&format!("Output serialization failed: {}", e)))?;

    Ok(js_output)
}
