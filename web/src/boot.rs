//! Boot graph (起搏图) — Cellrix:ADR-0021 T1a.
//!
//! The page used to be assembled by 23 chained `.replace()` calls inside
//! `main.rs`. The order and the placeholder→asset mapping are now data
//! (`assets/boot.json`) and this module walks that graph.
//!
//! **Output is byte-identical to the old mechanism.** That is not asserted by a
//! frozen golden file — a golden would bind the test to asset *content*, so any
//! legitimate asset edit would fail it. The oracle is the legacy sequence
//! itself, kept in `tests` below and re-reading the same assets: only a
//! *mechanism* regression can make the two sides differ.
//!
//! **Why the manifest below is Rust and not JSON.** `include_str!` takes a
//! string literal, so "which bytes are embedded" is necessarily a compile-time
//! decision and cannot be read out of the graph. The manifest lists *what is
//! embedded*; `boot.json` says *how it is assembled*. A new asset therefore
//! costs one manifest line plus one graph entry — and T1b removes the
//! `base.html` hole it used to also need.
//!
//! **Chain semantics are load-bearing.** `script.html` itself contains
//! `__REFRESH__`, so a derived value must be applied *after* its host piece is
//! expanded. A single-pass substitution would leave the literal on the page;
//! `derived_applies_after_its_host_piece` guards exactly that.

use serde::Deserialize;
use std::collections::BTreeSet;

/// The assembly graph. Editing this file alone changes what the page is made of.
const BOOT_JSON: &str = include_str!("../assets/boot.json");

/// Compile-time manifest of embedded assets: name → bytes.
///
/// One line per asset. `include_str!` needs a literal path, so this is the one
/// place a new asset must be named in Rust.
const EMBEDDED: &[(&str, &str)] = &[
    ("base.html", include_str!("../assets/base.html")),
    ("tokens.html", include_str!("../assets/tokens.html")),
    ("components.html", include_str!("../assets/components.html")),
    ("cockpit.html", include_str!("../assets/cockpit.html")),
    ("chat.html", include_str!("../assets/chat.html")),
    ("prove_track.html", include_str!("../assets/prove_track.html")),
    ("prove_track.css", include_str!("../assets/prove_track.css")),
    ("event_family.js", include_str!("../assets/event_family.js")),
    ("period_normalize.js", include_str!("../assets/period_normalize.js")),
    ("node_shape.js", include_str!("../assets/node_shape.js")),
    ("assembly.js", include_str!("../assets/assembly.js")),
    ("prove_track.data.js", include_str!("../assets/prove_track.data.js")),
    ("prove_track.render.js", include_str!("../assets/prove_track.render.js")),
    ("prove_track.node.js", include_str!("../assets/prove_track.node.js")),
    ("prove_track.export.js", include_str!("../assets/prove_track.export.js")),
    ("prove_track.view.js", include_str!("../assets/prove_track.view.js")),
    ("prove_track.js", include_str!("../assets/prove_track.js")),
    ("script.html", include_str!("../assets/script.html")),
    ("chat.js", include_str!("../assets/chat.js")),
    ("cockpit.js", include_str!("../assets/cockpit.js")),
    ("session.html", include_str!("../assets/session.html")),
    ("gleam.html", include_str!("../assets/gleam.html")),
    ("flows.html", include_str!("../assets/flows.html")),
];

/// Look one embedded asset up by name.
pub fn embedded(name: &str) -> Option<&'static str> {
    EMBEDDED.iter().find(|(n, _)| *n == name).map(|(_, c)| *c)
}

/// The graph as written on disk.
#[derive(Debug, Deserialize)]
pub struct BootGraph {
    /// Contract version — must track `docs/spec/grids.md`.
    pub version: String,
    /// Stage marker: `T1a` today, `T1b` once `base.html`'s holes collapse.
    #[serde(default)]
    pub stage: Option<String>,
    /// Template asset the pieces are substituted into.
    pub template: String,
    /// Ordered substitutions. **Array order is the assembly order.**
    pub pieces: Vec<Piece>,
    /// Values computed by the host, applied after every piece.
    #[serde(default)]
    pub derived: Vec<Derived>,
}

/// One asset bound to one placeholder.
#[derive(Debug, Deserialize)]
pub struct Piece {
    pub id: String,
    pub placeholder: String,
    pub asset: String,
}

/// One host-computed value bound to one placeholder.
#[derive(Debug, Deserialize)]
pub struct Derived {
    pub placeholder: String,
    /// Key into [`derived_value`]. A key with no arm is a hard error, never a
    /// silent empty string (0 hardcoding: every value has a named source).
    pub source: String,
}

/// Parse the graph. Malformed JSON is a build-time mistake surfacing here.
pub fn graph() -> Result<BootGraph, String> {
    serde_json::from_str(BOOT_JSON).map_err(|e| format!("boot.json 解析失败: {e}"))
}

/// Resolve a derived value's source key.
fn derived_value(source: &str) -> Result<String, String> {
    match source {
        "refresh_secs" => Ok(crate::config::REFRESH_SECS.to_string()),
        other => Err(format!("未知的派生源 '{other}'（见 boot.json 的 derived）")),
    }
}

/// Reject a graph that cannot assemble, naming the culprit.
///
/// These are the cheap, host-side half of `docs/spec/grids.md` §6; the grid
/// half (V1–V8) arrives with T1b.
pub fn validate(g: &BootGraph, template: &str) -> Result<(), String> {
    if g.version.trim().is_empty() {
        return Err("boot.json 缺少 version（须与 docs/spec/grids.md 对齐）".to_string());
    }
    let mut ids = BTreeSet::new();
    let mut holders = BTreeSet::new();
    for p in &g.pieces {
        if !ids.insert(p.id.as_str()) {
            return Err(format!("皮片 id 重复: {}", p.id));
        }
        if !holders.insert(p.placeholder.as_str()) {
            return Err(format!("占位符重复: {}", p.placeholder));
        }
        if embedded(&p.asset).is_none() {
            return Err(format!("皮片 {} 引用了未嵌入的资产: {}", p.id, p.asset));
        }
        if !template.contains(&p.placeholder) {
            return Err(format!(
                "模板 {} 中不存在占位符 {}（皮片 {}）",
                g.template, p.placeholder, p.id
            ));
        }
    }
    for d in &g.derived {
        if !holders.insert(d.placeholder.as_str()) {
            return Err(format!("占位符重复: {}", d.placeholder));
        }
        // Resolve now so a typo fails at assembly, not halfway through a page.
        derived_value(&d.source)?;
    }
    Ok(())
}

/// Assemble the page: every piece in graph order, then every derived value over
/// the whole result.
pub fn assemble(template: &str, g: &BootGraph) -> Result<String, String> {
    validate(g, template)?;
    let mut out = template.to_string();
    for p in &g.pieces {
        let bytes = embedded(&p.asset)
            .ok_or_else(|| format!("皮片 {} 的资产未嵌入: {}", p.id, p.asset))?;
        out = out.replace(&p.placeholder, bytes);
    }
    for d in &g.derived {
        out = out.replace(&d.placeholder, &derived_value(&d.source)?);
    }
    Ok(out)
}

/// Render the panel's index page from the graph.
pub fn render_index() -> Result<String, String> {
    let g = graph()?;
    let template = embedded(&g.template)
        .ok_or_else(|| format!("模板未嵌入: {}", g.template))?;
    assemble(template, &g)
}

/// One-line self-report of which assembly graph is live.
///
/// White-box: the panel names its own composition instead of leaving the
/// operator to infer it from the binary's age.
pub fn describe(g: &BootGraph) -> String {
    let stage = g.stage.as_deref().unwrap_or("unspecified");
    format!("起搏图 v{} [{}] · {} 皮片 · 模板 {}", g.version, stage, g.pieces.len(), g.template)
}

/// Loud, honest failure page. The panel is a local tool: a broken boot graph is
/// a build mistake, and showing it beats a blank page (fail-loud, never silent).
pub fn failure_page(reason: &str) -> String {
    format!(
        "<!DOCTYPE html>\n<html lang=\"zh-CN\"><head><meta charset=\"utf-8\">\
<title>Cellrix — 起搏图损坏</title></head><body>\
<h1>起搏图损坏</h1><p>面板无法装配，原因如下：</p><pre>{reason}</pre>\
<p>修复 <code>web/assets/boot.json</code> 后重新构建（资产在编译期嵌入）。</p>\
</body></html>"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The pre-T1a mechanism, verbatim: the 23 chained replacements in their
    /// original order, and the derived value last. This is the oracle — it
    /// re-reads the same assets, so an asset edit keeps both sides equal and
    /// only a mechanism regression can separate them.
    const LEGACY: &[(&str, &str)] = &[
        ("__TOKENS__", "tokens.html"),
        ("__COMPONENTS__", "components.html"),
        ("__COCKPIT__", "cockpit.html"),
        ("__CHAT__", "chat.html"),
        ("__PROVE_TRACK__", "prove_track.html"),
        ("__PROVE_TRACK_CSS__", "prove_track.css"),
        ("__EVENT_FAMILY__", "event_family.js"),
        ("__NORMALIZE__", "period_normalize.js"),
        ("__NODE_SHAPE__", "node_shape.js"),
        ("__ASSEMBLY__", "assembly.js"),
        ("__PROVE_TRACK_DATA__", "prove_track.data.js"),
        ("__PROVE_TRACK_RENDER__", "prove_track.render.js"),
        ("__PROVE_TRACK_NODE__", "prove_track.node.js"),
        ("__PROVE_TRACK_EXPORT__", "prove_track.export.js"),
        ("__PROVE_TRACK_VIEW__", "prove_track.view.js"),
        ("__PROVE_TRACK_CTRL__", "prove_track.js"),
        ("__SCRIPT__", "script.html"),
        ("__CHAT_JS__", "chat.js"),
        ("__COCKPIT_JS__", "cockpit.js"),
        ("__SESSION__", "session.html"),
        ("__GLEAM__", "gleam.html"),
        ("__FLOWS__", "flows.html"),
    ];

    fn legacy_index_html() -> String {
        let mut out = embedded("base.html").expect("base.html embedded").to_string();
        for (placeholder, asset) in LEGACY {
            out = out.replace(placeholder, embedded(asset).expect("asset embedded"));
        }
        out = out.replace("__REFRESH__", &crate::config::REFRESH_SECS.to_string());
        out
    }

    /// Byte offset of the first disagreement, quoted for a readable failure.
    fn first_diff(a: &str, b: &str) -> String {
        let (ab, bb) = (a.as_bytes(), b.as_bytes());
        for i in 0..ab.len().min(bb.len()) {
            if ab[i] != bb[i] {
                let lo = i.saturating_sub(24);
                return format!(
                    "首个差异 @ 字节 {i}\n  新: {:?}\n  旧: {:?}",
                    String::from_utf8_lossy(&ab[lo..(i + 24).min(ab.len())]),
                    String::from_utf8_lossy(&bb[lo..(i + 24).min(bb.len())]),
                );
            }
        }
        format!("长度不同: 新={} 旧={}", ab.len(), bb.len())
    }

    #[test]
    fn boot_output_is_byte_identical_to_the_legacy_mechanism() {
        let new = render_index().expect("boot graph must assemble");
        let old = legacy_index_html();
        assert!(
            new == old,
            "T1a 必须是纯重构，输出须逐字节相同\n{}",
            first_diff(&new, &old)
        );
    }

    #[test]
    fn graph_order_matches_the_legacy_sequence() {
        let g = graph().expect("boot.json parses");
        let got: Vec<(&str, &str)> = g
            .pieces
            .iter()
            .map(|p| (p.placeholder.as_str(), p.asset.as_str()))
            .collect();
        let want: Vec<(&str, &str)> = LEGACY.to_vec();
        assert_eq!(got, want, "boot.json 的 pieces 顺序/映射必须与旧序列一致");
    }

    #[test]
    fn graph_has_no_duplicate_ids_and_only_known_pieces() {
        let g = graph().expect("boot.json parses");
        let template = embedded(&g.template).expect("template embedded");
        validate(&g, template).expect("graph must be valid");
    }

    #[test]
    fn zero_placeholder_residue() {
        let page = render_index().expect("assembles");
        let mut left: Vec<&str> = page
            .match_indices("__")
            .filter_map(|(i, _)| {
                let rest = &page[i..];
                let end = rest[2..].find("__").map(|e| e + 2)?;
                let tok = &rest[..end + 2];
                let inner = &tok[2..tok.len() - 2];
                let ok = !inner.is_empty()
                    && inner.chars().all(|c| c.is_ascii_uppercase() || c == '_');
                if ok { Some(tok) } else { None }
            })
            .collect();
        left.sort_unstable();
        left.dedup();
        assert!(left.is_empty(), "页面残留占位符: {left:?}");
    }

    #[test]
    fn doctype_is_the_first_thing_in_the_page() {
        let page = render_index().expect("assembles");
        assert!(page.starts_with("<!DOCTYPE html>"), "首字节必须是 DOCTYPE");
    }

    /// The chain-semantics guard: `script.html` carries `__REFRESH__`, so the
    /// derived value is only reachable if it is applied after that piece.
    #[test]
    fn derived_applies_after_its_host_piece() {
        let script = embedded("script.html").expect("embedded");
        assert!(
            script.contains("__REFRESH__"),
            "此测试的前提是 script.html 含 __REFRESH__；若它已移除，请改换守卫对象"
        );
        let page = render_index().expect("assembles");
        assert_eq!(page.matches("__REFRESH__").count(), 0, "派生值未生效");
        assert!(
            page.contains(&format!("自动刷新 {}s", crate::config::REFRESH_SECS)),
            "刷新文案未替换"
        );
    }

    #[test]
    fn unknown_derived_source_fails_loudly() {
        let err = derived_value("no_such_source").expect_err("未知源必须报错");
        assert!(err.contains("no_such_source"), "错误须指名来源: {err}");
    }

    #[test]
    fn a_missing_template_placeholder_is_named() {
        let g = graph().expect("parses");
        let err = validate(&g, "<html></html>").expect_err("空模板必须失败");
        assert!(err.contains("不存在占位符"), "错误须说明缺失: {err}");
    }
}
