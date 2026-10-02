// 軽いチェックの「なぜ行けないか」を、目標から後ろ向きにたどって求める（regression）。
// 例: 「demand で証拠品 e を持っている」→ e を与える give → その give に着く辺の条件 → その条件のフラグを立てる set …
use super::abs::eval;
use super::fix::Fix;
use super::graph::{Effect, LEdge, LGraph, Site};
use crate::expr::show;
use crate::model::*;

/// 後ろ向きにたどるための、辺の元の一覧
pub fn preds(g: &LGraph) -> Vec<Vec<(u32, u32)>> {
    let mut p = vec![vec![]; g.nodes];
    for (u, es) in g.succ.iter().enumerate() {
        for (i, e) in es.iter().enumerate() {
            p[e.to as usize].push((u as u32, i as u32));
        }
    }
    p
}

/// 条件式のうち、値が決まってしまう部分（常に真・常に偽）を並べる
fn fixed_atoms(e: &Expr, fx: &Fix, m: &Model, node: u32, out: &mut Vec<String>) {
    match e {
        Expr::Not(x) => fixed_atoms(x, fx, m, node, out),
        Expr::Table(t) => fixed_atoms(&t.orig, fx, m, node, out),
        Expr::Bin(BinOp::And | BinOp::Or, l, r) => {
            fixed_atoms(l, fx, m, node, out);
            fixed_atoms(r, fx, m, node, out);
        }
        _ => {
            let (t, f) = eval(e, &fx.facts(node), m).truth();
            if t != f {
                let s = format!("{} は常に{}", show(e, m), if t { "真" } else { "偽" });
                if !out.contains(&s) {
                    out.push(s);
                }
            }
        }
    }
}

/// 辺を通れない理由
pub fn why_edge(fx: &Fix, m: &Model, g: &LGraph, node: u32, e: &LEdge) -> String {
    if let Some(x) = e.ev.filter(|&x| !fx.may_hold(node, x)) {
        let what = if m.is_profile(x) {
            "人物ファイル"
        } else {
            "証拠品"
        };
        return format!("{what}「{}」をそこで持てない", m.evidence[x as usize].name);
    }
    if e.person.is_some_and(|p| !fx.person(m, g, p)) {
        return "相手の人物がいない".into();
    }
    let Some(c) = e.cond else {
        return "不明".into();
    };
    let mut atoms = vec![];
    fixed_atoms(c, fx, m, node, &mut atoms);
    atoms.truncate(4);
    let need = if e.site == Site::IfElse { "偽" } else { "真" };
    let detail = if atoms.is_empty() {
        String::new()
    } else {
        format!("。{}", atoms.join("、"))
    };
    format!("条件「{}」が{need}にならない{detail}", show(c, m))
}

/// 着けない地点の集まり（to から後ろ向きに、着けない地点だけをたどる）の入り口で、通れない辺の理由を集める
pub fn blocking(fx: &Fix, m: &Model, g: &LGraph, pr: &[Vec<(u32, u32)>], to: &[u32]) -> String {
    let mut seen = vec![false; 0];
    seen.resize(g.nodes, false);
    let mut todo: Vec<u32> = to.to_vec();
    for &t in to {
        seen[t as usize] = true;
    }
    // 理由ごとに、その辺の元のシーンを集める
    let mut reasons: Vec<(String, Vec<String>)> = vec![];
    let (mut any_pred, mut count) = (false, 0);
    // 元をたどって行き着いた、どこからも入れない地点（のシーン）
    let mut roots: Vec<String> = vec![];
    while let Some(w) = todo.pop() {
        count += 1;
        if count > 20_000 || reasons.len() >= 3 {
            break;
        }
        if pr[w as usize].is_empty() && !to.contains(&w) {
            let id = m.scenes[g.scene_of[w as usize] as usize].id.clone();
            if !roots.contains(&id) {
                roots.push(id);
            }
        }
        for &(u, i) in &pr[w as usize] {
            any_pred = true;
            if fx.reached[u as usize] {
                let e = &g.succ[u as usize][i as usize];
                let why = why_edge(fx, m, g, u, e);
                let at = m.scenes[g.scene_of[u as usize] as usize].id.clone();
                match reasons.iter_mut().find(|(w, _)| *w == why) {
                    Some((_, list)) => {
                        if !list.contains(&at) {
                            list.push(at)
                        }
                    }
                    None => reasons.push((why, vec![at])),
                }
            } else if !seen[u as usize] {
                seen[u as usize] = true;
                todo.push(u);
            }
        }
    }
    if reasons.is_empty() {
        if !any_pred {
            return "（入る道がありません）".into();
        }
        roots.truncate(3);
        return if roots.is_empty() {
            "（入る道の手前にも着けません）".into()
        } else {
            format!(
                "（元をたどると、どこからも入れない {} に行き着きます）",
                roots.join("・")
            )
        };
    }
    let text: Vec<String> = reasons
        .into_iter()
        .map(|(why, at)| {
            let more = if at.len() > 3 {
                format!(" など {} か所", at.len())
            } else {
                String::new()
            };
            format!("{}{more}: {why}", at[..at.len().min(3)].join("・"))
        })
        .collect();
    format!("（{}）", text.join(" / "))
}

/// 証拠品 x を、地点 node で持てない理由
pub fn why_evidence(
    fx: &Fix,
    m: &Model,
    g: &LGraph,
    pr: &[Vec<(u32, u32)>],
    node: u32,
    x: u32,
) -> String {
    let name = &m.evidence[x as usize].name;
    let gives: Vec<u32> = (0..g.nodes as u32)
        .filter(|&v| matches!(g.effect[v as usize], Effect::Give(y) if y == x))
        .collect();
    let at_start = m.start_evidence.contains(&x);
    if gives.is_empty() && !at_start {
        let how = if m.is_profile(x) {
            "giveProfile・始めの人物ファイル"
        } else {
            "give・始めの証拠品"
        };
        return format!("「{name}」を手に入れる命令（{how}）がありません");
    }
    let scenes = |list: &[u32]| {
        let mut ids: Vec<&str> = list
            .iter()
            .map(|&v| m.scenes[g.scene_of[v as usize] as usize].id.as_str())
            .collect();
        ids.dedup();
        let more = if ids.len() > 3 {
            format!(" など {} か所", ids.len())
        } else {
            String::new()
        };
        ids.truncate(3);
        format!("{}{more}", ids.join("・"))
    };
    if !at_start && gives.iter().all(|&v| !fx.reached[v as usize]) {
        let entries: Vec<u32> = gives.clone();
        return format!(
            "「{name}」を手に入れる give（{}）に着けません{}",
            scenes(&gives),
            blocking(fx, m, g, pr, &entries)
        );
    }
    // ここから後ろ向きに、通れる辺だけをたどる。取り上げる所（take）で止める
    let mut seen = vec![false; g.nodes];
    let mut todo = vec![node];
    seen[node as usize] = true;
    let mut takes = vec![];
    while let Some(w) = todo.pop() {
        for &(u, i) in &pr[w as usize] {
            if !fx.reached[u as usize] || seen[u as usize] {
                continue;
            }
            if !fx.edge_ok(m, g, u, &g.succ[u as usize][i as usize]) {
                continue;
            }
            seen[u as usize] = true;
            match g.effect[u as usize] {
                Effect::Take(y) if y == x => takes.push(u),
                _ => todo.push(u),
            }
        }
    }
    if takes.is_empty() {
        format!("「{name}」を手に入れた後の道から、ここに着けません")
    } else {
        format!(
            "「{name}」を手に入れても、ここに着くまでに取り上げられます（take: {}）",
            scenes(&takes)
        )
    }
}

/// フラグを値にする set の場所の説明（なし・着けない所だけ）
pub fn set_sites(fx: &Fix, m: &Model, g: &LGraph, f: u32, ok: impl Fn(FVal) -> bool) -> String {
    let sites: Vec<u32> = (0..g.nodes as u32)
        .filter(|&v| matches!(g.effect[v as usize], Effect::Set(y, val) if y == f && ok(val)))
        .collect();
    if sites.is_empty() {
        return "その値にする set がありません".into();
    }
    if sites.iter().all(|&v| !fx.reached[v as usize]) {
        let mut ids: Vec<&str> = sites
            .iter()
            .map(|&v| m.scenes[g.scene_of[v as usize] as usize].id.as_str())
            .collect();
        ids.dedup();
        ids.truncate(3);
        return format!(
            "その値にする set は {} にありますが、着けません",
            ids.join("・")
        );
    }
    "その値にする set はありますが、条件の組み合わせで満たせません".into()
}
