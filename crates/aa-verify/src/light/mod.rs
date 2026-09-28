// 軽いチェック（既定）。状態を区別せず、流れのグラフの上の近似で、速く次の 3 つを調べる。
// 1. 証拠品: つきつけの正解（demand・尋問・探偵パート）の証拠品を、その場面に着いた時点で持っている道があるか
// 2. 到達: 各シーン・場所に、始まりから着ける道があるか（条件が満たせるかも、3. の値の集まりで考える）
// 3. フラグ: 条件式で読まれるフラグの値にする set が、着ける所にあるか。満たせない条件（when・if・移動・話題・調べる所）
// 近似なので、見落とし（状態の組み合わせで初めて起きる問題）も、まれに誤検知もありうる。網羅的には --complete。
// 行けないものは、目標から後ろ向きにたどって、どの条件で行き詰まったかを添える（explain.rs）。
mod abs;
mod explain;
mod fix;
mod graph;

use crate::expr::show;
use crate::model::*;
use crate::report::Finding;
use abs::eval;
use explain::{blocking, preds, set_sites, why_evidence};
use graph::{LGraph, Site};

pub const KIND_EVIDENCE: &str = "証拠品";
pub const KIND_REACH: &str = "到達";
pub const KIND_FLAG: &str = "フラグ";

pub fn check(model: &Model) -> Vec<Finding> {
    let g = graph::build(model);
    let fx = fix::run(model, &g);
    let pr = preds(&g);
    let mut out = vec![];
    evidence(model, &g, &fx, &pr, &mut out);
    reach(model, &g, &fx, &pr, &mut out);
    flags(model, &g, &fx, &mut out);
    out
}

fn scene_id(m: &Model, g: &LGraph, node: u32) -> String {
    m.scenes[g.scene_of[node as usize] as usize].id.clone()
}

/// 1. つきつけの正解の証拠品を持てるか
fn evidence(m: &Model, g: &LGraph, fx: &fix::Fix, pr: &[Vec<(u32, u32)>], out: &mut Vec<Finding>) {
    let names = |xs: &[u32]| xs.iter().map(|&x| m.evidence[x as usize].name.as_str()).collect::<Vec<_>>().join("・");
    for (si, sc) in m.scenes.iter().enumerate() {
        // つきつける場面ごとに（地点, 場面の説明, 正解, 1 つも持てないと先へ進めないか）
        let mut points: Vec<(u32, String, Vec<u32>, bool)> = vec![];
        for (pc, ins) in sc.program.iter().enumerate() {
            if let Op::Demand { prompt, options, profiles, .. } = ins {
                let text: String = crate::rich_plain(prompt);
                let answers = options.iter().chain(profiles.iter().flatten()).map(|(x, _)| *x).collect();
                points.push((g.base[si] + pc as u32, format!("つきつけの要求「{text}」"), answers, true));
            }
        }
        match &sc.kind {
            Kind::Testimony(t) => {
                let mut ans = vec![];
                for st in &t.statements { for (x, _) in st.present.iter().chain(st.present_profile.iter().flatten()) { if !ans.contains(x) { ans.push(*x); } } }
                points.push((g.testimony[si], format!("尋問「{}」", t.title), ans, true));
            }
            Kind::Place(p) if !p.present.is_empty() || !p.present_profile.is_empty() => {
                let answers = p.present.iter().chain(&p.present_profile).map(|(x, _)| *x).collect();
                points.push((g.menu[si], format!("場所「{}」のつきつけ", p.name), answers, false));
            }
            _ => {}
        }
        for (node, what, answers, needed) in points {
            if !fx.reached[node as usize] || answers.is_empty() { continue; }
            let lack: Vec<u32> = answers.iter().copied().filter(|&x| !fx.may_hold(node, x)).collect();
            if lack.is_empty() { continue; }
            let why: Vec<String> = lack.iter().take(3).map(|&x| why_evidence(fx, m, g, pr, node, x)).collect();
            let f = if needed && lack.len() == answers.len() {
                Finding::error(format!("{what}の正解（{}）を、どれも持てません（先へ進めない可能性）。{}", names(&answers), why.join("。")), Some(sc.id.clone()))
            } else {
                Finding::warning(format!("{what}の正解のうち「{}」は、その時点で持てません。{}", names(&lack), why.join("。")), Some(sc.id.clone()))
            };
            out.push(f.kind(KIND_EVIDENCE));
        }
    }
}

/// 2. シーン・場所に着けるか
fn reach(m: &Model, g: &LGraph, fx: &fix::Fix, pr: &[Vec<(u32, u32)>], out: &mut Vec<Finding>) {
    for (i, sc) in m.scenes.iter().enumerate() {
        if sc.id.starts_with("__") || m.gameover_scene == Some(i as u32) { continue; }
        // 入った所か、着いた所（場所なら探偵メニュー）のどちらかに着ければよい
        let to: Vec<u32> = [g.entry(m, i as u32), g.arrive(m, i as u32)].into_iter().flatten().collect();
        if to.iter().any(|&v| fx.reached[v as usize]) { continue; }
        let what = if sc.place().is_some() { "場所" } else { "シーン" };
        let why = blocking(fx, m, g, pr, &to);
        out.push(Finding::warning(format!("{what}「{}」には着けません{why}", sc.id), Some(sc.id.clone())).kind(KIND_REACH));
    }
}

/// 3. 満たせない条件と、読まれる値にならないフラグ
fn flags(m: &Model, g: &LGraph, fx: &fix::Fix, out: &mut Vec<Finding>) {
    let mut done: Vec<(u32, *const Expr)> = vec![];
    let mut flag_done: Vec<String> = vec![];
    for v in 0..g.nodes as u32 {
        if !fx.reached[v as usize] { continue; }
        for e in &g.succ[v as usize] {
            let Some(c) = e.cond else { continue };
            // else 側（条件が常に真）は「満たせない条件」ではないので数えない
            if e.site == Site::IfElse || done.contains(&(v, c as *const Expr)) { continue; }
            done.push((v, c as *const Expr));
            let scene = scene_id(m, g, v);
            if !fx.cond_ok(m, v, e) {
                let what = site_name(m, g, v, e);
                out.push(Finding::warning(format!("{what}の条件「{}」は満たせません", show(c, m)), Some(scene.clone())).kind(KIND_FLAG));
            }
            atoms(m, g, fx, v, c, true, &scene, &mut flag_done, out);
        }
    }
}

fn site_name(m: &Model, g: &LGraph, v: u32, e: &graph::LEdge) -> String {
    let place = m.scenes[g.scene_of[v as usize] as usize].place();
    let seen_name = |x: u32| m.seen_ids[x as usize].clone();
    match e.site {
        Site::Choice => "選択肢".into(),
        Site::Statement => "証言".into(),
        Site::IfThen => "if".into(),
        Site::Talk => format!("話題「{}」", place.and_then(|p| p.talk.iter().find(|t| Some(t.seen) == e.seen)).map_or_else(|| seen_name(e.seen.unwrap_or(0)), |t| t.topic.clone())),
        Site::Examine => format!("調べる所「{}」", place.and_then(|p| p.examine.iter().find(|t| Some(t.seen) == e.seen)).and_then(|x| x.name.clone()).unwrap_or_else(|| seen_name(e.seen.unwrap_or(0)))),
        Site::Move => format!("移動先「{}」", m.scenes.get(g.scene_of[e.to as usize] as usize).map_or("?", |s| s.id.as_str())),
        _ => "条件".into(),
    }
}

/// 条件の中の、フラグを読む部分（真偽のフラグ・数との比べ）ごとに、求める値になりうるかを見る
#[allow(clippy::too_many_arguments)]
fn atoms(m: &Model, g: &LGraph, fx: &fix::Fix, v: u32, e: &Expr, want: bool, scene: &str, done: &mut Vec<String>, out: &mut Vec<Finding>) {
    match e {
        Expr::Not(x) => atoms(m, g, fx, v, x, !want, scene, done, out),
        Expr::Table(t) => atoms(m, g, fx, v, &t.orig, want, scene, done, out),
        Expr::Bin(BinOp::And | BinOp::Or, l, r) => {
            atoms(m, g, fx, v, l, want, scene, done, out);
            atoms(m, g, fx, v, r, want, scene, done, out);
        }
        Expr::Var(_) | Expr::Bin(_, _, _) => {
            let flag = match e {
                Expr::Var(f) => *f,
                Expr::Bin(_, l, r) => match (&**l, &**r) {
                    (Expr::Var(f), Expr::Lit(_)) | (Expr::Lit(_), Expr::Var(f)) => *f,
                    _ => return,
                },
                _ => unreachable!(),
            };
            let (t, fa) = eval(e, &fx.facts(v), m).truth();
            if (want && t) || (!want && fa) { return; }
            let text = format!("{} が{}に", show(e, m), if want { "真" } else { "偽" });
            if done.contains(&text) { return; }
            done.push(text.clone());
            // その値にする set を探す（真偽のフラグそのものなら、真偽の値。比べなら、比べが want になる値）
            let fl = e.clone();
            let why = set_sites(fx, m, g, flag, |val| {
                let mut vals = fx.flags.clone();
                vals[flag as usize] = abs::Vals { list: vec![val], any_num: false };
                let facts = abs::Facts { flags: &vals, visited: &fx.visited, seen: &fx.seen, may: &[], must: &[] };
                let (t, f) = eval(&fl, &facts, m).truth();
                if want { t } else { f }
            });
            let values: Vec<String> = fx.flags[flag as usize].list.iter().map(|x| crate::expr::JsVal::from_flag(*x, m).string()).collect();
            out.push(Finding::warning(
                format!("フラグ {}なりません（取りうる値: {}。{why}）", text, values.join("・")),
                Some(scene.to_string()),
            ).kind(KIND_FLAG));
        }
        _ => {}
    }
}
