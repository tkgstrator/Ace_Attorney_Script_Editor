// シナリオの整合性チェック（packages/script の verify の Rust 版）。
// コンパイル済みのシナリオ（IR の JSON。packages/script/src/export-ir.ts が書き出す）を読んで調べる。
// - complete: すべての遊び方を試す網羅的な探索（TS 版の verifyScenario と同じ報告）
// - light: 状態を区別しない、速い近似のチェック
pub mod actions;
pub mod defer;
pub mod engine;
pub mod engine_place;
pub mod evflow;
pub mod expr;
pub mod fast;
pub mod flow;
pub mod flowgraph;
pub mod graph;
pub mod inspect;
pub mod key;
pub mod light;
pub mod load;
pub mod model;
pub mod partsearch;
pub mod region;
pub mod report;
pub mod search;
pub mod state;

use actions::Prep;
use report::Finding;
use search::{explore, SearchOptions};

/// 調べるときのライフ（減らないものとして調べる）
pub const IMMORTAL: f64 = 1e9;
pub const DEFAULT_LIMIT: usize = 3_000_000;

pub struct CompleteOptions {
    pub limit: usize,
    /// false にすると、生きている変数だけをキーに入れる工夫をやめる（確かめ用）
    pub liveness: bool,
    /// TS 版と同じ状態の見分け方にする（状態の数・番号まで TS 版と一致させて比べるため）
    pub ts_exact: bool,
    /// 編ごとに調べる（partsearch.rs）
    pub parts: bool,
    /// 詰みを見つけたら、その場面から TS 版と同じ見分け方で探索し直して確かめる（状態の数の上限）
    pub confirm: Option<usize>,
    pub progress: Option<Box<dyn Fn(usize, usize)>>,
}

pub struct CompleteResult {
    pub findings: Vec<Finding>,
    pub states: usize,
    pub truncated: bool,
    pub peak_pending: usize,
    pub peak_pending_bytes: usize,
    pub graph_bytes: usize,
    pub per_scene: Vec<u32>,
    /// 編ごとの数字（編ごとに調べたときだけ）
    pub parts: Vec<partsearch::PartStat>,
    /// シーンごとの編の番号
    pub part_of: Vec<u16>,
}

/// 網羅的な探索（TS 版の verifyScenario と同じ）
pub fn verify_complete(
    model: &model::Model,
    opts: CompleteOptions,
) -> Result<CompleteResult, String> {
    let mut m = model.clone();
    m.max_life = IMMORTAL;
    let fopts = flow::FlowOptions {
        all: !opts.liveness,
        evidence: !opts.ts_exact && opts.liveness,
    };
    let prep = Prep::new(&m);
    let so = SearchOptions {
        limit: opts.limit,
        progress: opts.progress,
        progress_every: 100_000,
    };
    let (r, findings, parts, part_of) = if opts.parts && !opts.ts_exact {
        let built = flowgraph::build(&m);
        let ps = partsearch::explore_parts(&m, &built, &prep, &so, fopts)?;
        let stop_of = |id: u32| actions::Stop::Part {
            part_of: &ps.group_of,
            part: ps.group_of_id[id as usize],
        };
        let findings = report::findings(&m, stop_of, &prep, &ps.search, opts.limit, opts.confirm);
        (ps.search, findings, ps.stats, ps.group_of)
    } else {
        let flow = flow::analyze(&m, fopts);
        let r = explore(&m, &flow, &prep, &so)?;
        let findings = report::findings(
            &m,
            |_| actions::Stop::Merge(&flow),
            &prep,
            &r,
            opts.limit,
            opts.confirm,
        );
        (r, findings, vec![], partsearch::part_table(&m))
    };
    Ok(CompleteResult {
        findings,
        states: r.states,
        truncated: r.truncated,
        peak_pending: r.peak_pending,
        peak_pending_bytes: r.peak_pending_bytes,
        graph_bytes: r.graph.memory(),
        per_scene: r.per_scene,
        parts,
        part_of,
    })
}

/// 差分テスト用: 編ごとの網羅的な探索で見つけた状態から count 個を選び、始まりからその状態までのエンジンの操作の列と、
/// 着いた状態を返す（TS のエンジンで同じ列を実行して、同じ状態になるかを比べる）
pub fn sample_paths(
    model: &model::Model,
    count: usize,
    limit: usize,
) -> Result<Vec<(Vec<String>, state::State)>, String> {
    let mut m = model.clone();
    m.max_life = IMMORTAL;
    let fopts = flow::FlowOptions {
        all: false,
        evidence: true,
    };
    let prep = Prep::new(&m);
    let so = SearchOptions {
        limit,
        progress: None,
        progress_every: usize::MAX,
    };
    let built = flowgraph::build(&m);
    let ps = partsearch::explore_parts(&m, &built, &prep, &so, fopts)?;
    let stop_of = |id: u32| actions::Stop::Part {
        part_of: &ps.group_of,
        part: ps.group_of_id[id as usize],
    };
    let n = ps.search.parent.len().min(ps.search.states);
    let mut out = vec![];
    for k in 0..count.min(n) {
        let id = (k * n / count.min(n).max(1)) as u32;
        let mut ops = vec![];
        let e = search::rebuild_ops(&m, stop_of, &prep, &ps.search, id, Some(&mut ops))?;
        out.push((ops, e.s));
    }
    Ok(out)
}

/// 文中コマンド（[wait 8] など）を取り除いた文（core の plainText と同じ。[[ は [）
pub fn rich_plain(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(i) = rest.find('[') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        if let Some(stripped) = after.strip_prefix('[') {
            out.push('[');
            rest = stripped;
            continue;
        }
        match after.find(']') {
            Some(j) => rest = &after[j + 1..],
            None => return text.to_string(),
        }
    }
    out.push_str(rest);
    out.replace('\n', "")
}

/// IR の JSON を調べて、結果を JSON で返す（WebAssembly などから呼ぶための入口。CLI の --json と同じ形）。
/// complete: 網羅的な探索。そうでなければ軽いチェック
pub fn verify_json(ir: &str, complete: bool, limit: usize) -> Result<String, String> {
    let m = load::load(ir)?;
    if !complete {
        let f = light::check(&m);
        return Ok(
            serde_json::json!({ "mode": "light", "findings": report::findings_json(&f) })
                .to_string(),
        );
    }
    let r = verify_complete(
        &m,
        CompleteOptions {
            limit,
            liveness: true,
            ts_exact: false,
            parts: true,
            confirm: None,
            progress: None,
        },
    )?;
    Ok(serde_json::json!({
        "mode": "complete", "states": r.states, "truncated": r.truncated, "findings": report::findings_json(&r.findings),
        "parts": r.parts.iter().map(|p| serde_json::json!({ "id": p.id, "states": p.states, "entries": p.entries, "versions": p.versions, "sec": p.sec })).collect::<Vec<_>>(),
    }).to_string())
}
