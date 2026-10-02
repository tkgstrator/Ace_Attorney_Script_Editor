// 探索の結果から、報告（詰み・end に着けない・到達しないもの）を作る（verify.ts の後半と同じ文）。
use crate::actions::{Prep, Stop};
use crate::engine::{BeatKind, Engine};
use crate::expr::{num_string, JsVal};
use crate::graph::traps;
use crate::model::*;
use crate::search::{rebuild_ops, Search};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Finding {
    pub error: bool,
    pub message: String,
    pub scene: Option<String>,
    /// 報告の種類（軽いチェックの項目など。なければ None）
    pub kind: Option<&'static str>,
    /// 詰みの場面までの再現手順（エンジンの操作の列。文章送りの続きは「a×回数」にまとめる）
    pub path: Option<String>,
}

impl Finding {
    pub fn error(message: String, scene: Option<String>) -> Finding {
        Finding {
            error: true,
            message,
            scene,
            kind: None,
            path: None,
        }
    }
    pub fn warning(message: String, scene: Option<String>) -> Finding {
        Finding {
            error: false,
            message,
            scene,
            kind: None,
            path: None,
        }
    }
    pub fn kind(mut self, kind: &'static str) -> Finding {
        self.kind = Some(kind);
        self
    }
}

/// 文中の {名前} を、一時的な値・ライフ・フラグの値に置き換える（core の interpolate）
fn interpolate(text: &str, e: &Engine) -> String {
    let m = e.m;
    let mut out = String::new();
    let mut rest = text;
    while let Some(open) = rest.find('{') {
        out.push_str(&rest[..open]);
        let after = &rest[open + 1..];
        let len = after
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
            .unwrap_or(after.len());
        let name = &after[..len];
        let ok = after[len..].starts_with('}')
            && name
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphabetic() || c == '_');
        let value = if !ok {
            None
        } else if name == "evidence" && e.s.var_ev.is_some() {
            Some(m.evidence[e.s.var_ev.unwrap() as usize].name.clone())
        } else if name == "life" {
            Some(num_string(e.s.life))
        } else {
            m.flag_index(name)
                .map(|f| e.s.flags[f as usize])
                .filter(|v| *v != FVal::Undef)
                .map(|v| JsVal::from_flag(v, m).string())
        };
        match value {
            Some(v) => {
                out.push_str(&v);
                rest = &after[len + 1..];
            }
            None => {
                out.push('{');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// 詰みの場面の説明（何を求められていて、何が足りないか）
fn describe(e: &Engine, b: BeatKind) -> String {
    let m = e.m;
    let name = |id: u32| m.evidence[id as usize].name.clone();
    let missing = |ids: &[u32]| {
        ids.iter()
            .filter(|&&x| !e.s.holds(x))
            .map(|&x| name(x))
            .collect::<Vec<_>>()
    };
    let scene = m.scenes.get(e.s.scene as usize);
    if b == BeatKind::Demand {
        let (prompt, answers): (String, Vec<u32>) =
            match scene.and_then(|s| s.program.get(e.s.pc as usize)) {
                Some(Op::Demand {
                    prompt,
                    options,
                    profiles,
                    ..
                }) => (
                    interpolate(prompt, e),
                    options
                        .iter()
                        .chain(profiles.iter().flatten())
                        .map(|(x, _)| *x)
                        .collect(),
                ),
                _ => (String::new(), vec![]),
            };
        let lack = missing(&answers);
        let all: Vec<String> = answers.iter().map(|&x| name(x)).collect();
        let tail = if lack.len() == answers.len() {
            String::new()
        } else {
            format!("（持っていない: {}）", lack.join("・"))
        };
        return format!(
            "つきつけの要求「{prompt}」の正解（{}）を持っていません{tail}",
            all.join("・")
        );
    }
    if let Some(t) = scene.and_then(|s| s.testimony()) {
        let mut answers: Vec<u32> = vec![];
        for st in &t.statements {
            for (x, _) in st.present.iter().chain(st.present_profile.iter().flatten()) {
                if !answers.contains(x) {
                    answers.push(*x);
                }
            }
        }
        let lack = missing(&answers);
        return format!(
            "尋問「{}」から先へ進めません（つきつけで使う {} のうち、持っていない: {}）",
            t.title,
            answers
                .iter()
                .map(|&x| name(x))
                .collect::<Vec<_>>()
                .join("・"),
            if lack.is_empty() {
                "なし".to_string()
            } else {
                lack.join("・")
            }
        );
    }
    if b == BeatKind::Investigate {
        let n = scene
            .and_then(|s| s.place())
            .map(|p| p.name.clone())
            .unwrap_or_default();
        return format!(
            "探索編の「{n}」から先へ進めません（移動先・話題・調べる所の条件を満たせない可能性）"
        );
    }
    format!(
        "シーン「{}」から先へ進めません（{}）",
        m.scene_name(e.s.scene),
        b.name()
    )
}

/// 詰みの報告（抜け出せない状態のかたまりごとに、判断の場面を 1 つ）
pub fn trap_findings<'a>(
    m: &Model,
    stop_of: impl Fn(u32) -> Stop<'a> + Copy,
    prep: &Prep,
    r: &Search,
    confirm: Option<usize>,
    out: &mut Vec<Finding>,
) {
    let mut reported: Vec<String> = vec![];
    for trap in traps(&r.graph, r.states, |v| r.goals[v as usize]) {
        let best = trap.iter().copied().fold(trap[0], |a, b| {
            if r.ranks[b as usize] < r.ranks[a as usize] {
                b
            } else {
                a
            }
        });
        let mut ops = vec![];
        let pick = match rebuild_ops(m, stop_of, prep, r, best, Some(&mut ops)) {
            Ok(e) => e,
            Err(msg) => {
                out.push(Finding::error(
                    format!("詰みの場面を作り直せません: {msg}"),
                    None,
                ));
                continue;
            }
        };
        let Ok(b) = pick.beat() else { continue };
        let scene = m.scene_name(pick.s.scene).to_string();
        let at = format!("{scene}:{}", b.name());
        if reported.contains(&at) {
            continue;
        }
        reported.push(at);
        let mut msg = format!("詰み: {}", describe(&pick, b));
        // 確かめ: 詰みの場面から、TS 版と同じ見分け方で探索し直す
        if let Some(limit) = confirm {
            let note = match confirm_trap(m, prep, &pick, limit) {
                Confirm::Stuck(n) => {
                    format!("確かめ済み: この場面から {n} 状態を調べ、終わりに着かない")
                }
                Confirm::Escaped(n) => {
                    format!("確かめで食い違い: この場面から {n} 状態で終わりに着いた")
                }
                Confirm::Unknown(n) => format!("確かめきれず: {n} 状態で打ち切り"),
            };
            msg += &format!("（{note}）");
        }
        let mut f = Finding::error(msg, Some(scene));
        f.path = Some(compact(&ops));
        out.push(f);
    }
}

/// 操作の列を短く書く（続く文章送り a は a×回数）
pub fn compact(ops: &[String]) -> String {
    let mut out: Vec<String> = vec![];
    let mut i = 0;
    while i < ops.len() {
        let mut j = i;
        while j < ops.len() && ops[j] == ops[i] {
            j += 1;
        }
        out.push(if j - i > 1 {
            format!("{}×{}", ops[i], j - i)
        } else {
            ops[i].clone()
        });
        i = j;
    }
    out.join(" ")
}

/// ライフが尽きたときに入るシーン（gameover に指定したシーン・life_out）と、そこから goto / investigate だけで行けるシーン
/// （verify.ts の lifeOutClosure と同じ）
fn life_out_closure(m: &Model) -> Vec<bool> {
    let mut seen = vec![false; m.scenes.len()];
    let mut todo: Vec<u32> = m
        .gameover_scene
        .into_iter()
        .chain(m.life_out.iter().copied())
        .collect();
    while let Some(i) = todo.pop() {
        let Some(sc) = m.scenes.get(i as usize) else {
            continue;
        };
        if std::mem::replace(&mut seen[i as usize], true) {
            continue;
        }
        for op in &sc.program {
            if let Op::Goto(t) | Op::Investigate(t) = op {
                todo.push(*t);
            }
        }
    }
    seen
}

/// 一度も到達しないシーン・場所・調べる所・話題
pub fn unreached_findings(m: &Model, r: &Search, out: &mut Vec<Finding>) {
    let life_out = life_out_closure(m);
    for (i, sc) in m.scenes.iter().enumerate() {
        // ライフが尽きたときのシーン（とその先）は、ライフを減らさずに調べるので除く
        if sc.id.starts_with("__") || life_out[i] {
            continue;
        }
        let Some(p) = sc.place() else {
            if !r.visited.has(i as u32) {
                out.push(Finding::warning(
                    format!("シーン「{}」には、どう遊んでもたどり着きません", sc.id),
                    Some(sc.id.clone()),
                ));
            }
            continue;
        };
        // 移動できても、来たときのブロックで抜けるだけの場所は探偵メニューに着かない（visited にならない）が、たどり着けてはいる
        // （調べる所・話題は、その探偵メニューに着けたときだけ数える）
        if !r.visited.has(i as u32) {
            if !r.moved.has(i as u32) {
                out.push(Finding::warning(
                    format!("場所「{}」には、どう遊んでもたどり着きません", sc.id),
                    Some(sc.id.clone()),
                ));
            }
            continue;
        }
        // 調べる所・話題（同じ名前のものが同じ場所に複数あるときは ID も添える）
        let items: Vec<(bool, String, u32)> = p
            .examine
            .iter()
            .map(|x| {
                (
                    false,
                    x.name
                        .clone()
                        .unwrap_or_else(|| m.seen_ids[x.seen as usize].clone()),
                    x.seen,
                )
            })
            .chain(p.talk.iter().map(|t| (true, t.topic.clone(), t.seen)))
            .collect();
        for (topic, title, seen) in &items {
            if r.seen.has(*seen) {
                continue;
            }
            let same = items
                .iter()
                .filter(|(t2, n2, _)| n2 == title && t2 == topic)
                .count()
                > 1;
            let label = format!(
                "{}「{title}」{}",
                if *topic { "話題" } else { "調べる所" },
                if same {
                    format!("（{}）", m.seen_ids[*seen as usize])
                } else {
                    String::new()
                }
            );
            out.push(Finding::warning(
                format!("場所「{}」の{label}は、どう遊んでも選べません", p.name),
                Some(sc.id.clone()),
            ));
        }
    }
}

/// ロックを外さないままクリアしたときに通る印のシーンの ID の頭（core の LOCK_END_PREFIX）
pub const LOCK_END_PREFIX: &str = "__lockend_";

/// サイコ・ロックを外さないままクリアできる（印のシーンを通った。verify.ts の lockEndMessage と同じ文）
pub fn lock_end_findings(m: &Model, r: &Search, out: &mut Vec<Finding>) {
    for (i, sc) in m.scenes.iter().enumerate() {
        let Some(id) = sc.id.strip_prefix(LOCK_END_PREFIX) else {
            continue;
        };
        if r.visited.has(i as u32) {
            out.push(Finding::error(format!("サイコ・ロック「{id}」を外さないまま、クリア（end）にたどり着けます（ロックが先へ進むのを止めていません）"), None));
        }
    }
}

/// 探索の結果の報告をすべて並べる（TS 版と同じ順）
pub fn findings<'a>(
    m: &Model,
    stop_of: impl Fn(u32) -> Stop<'a> + Copy,
    prep: &Prep,
    r: &Search,
    limit: usize,
    confirm: Option<usize>,
) -> Vec<Finding> {
    let mut out: Vec<Finding> = r
        .crashes
        .iter()
        .map(|(msg, s)| Finding::error(msg.clone(), Some(m.scene_name(*s).to_string())))
        .collect();
    if !r.truncated {
        if !r.cleared {
            out.push(Finding::error(
                "どう遊んでもクリア（end）にたどり着けません".into(),
                None,
            ));
        }
        lock_end_findings(m, r, &mut out);
        trap_findings(m, stop_of, prep, r, confirm, &mut out);
        unreached_findings(m, r, &mut out);
    } else {
        out.push(Finding::warning(
            format!(
                "状態が {limit} 個を超えたため、途中で調べるのをやめました（結果は不完全です）"
            ),
            None,
        ));
    }
    out
}

/// 詰みの確かめ（TS 版と同じ見分け方で、詰みの場面から終わりに着けるかを、もう一度調べる）の結果
pub enum Confirm {
    /// 終わりに着けなかった（詰みで正しい）
    Stuck(usize),
    /// 終わりに着けた（詰みの判定が誤り）
    Escaped(usize),
    /// 状態が多すぎて調べきれなかった
    Unknown(usize),
}

/// 詰みの場面 e から、状態の見分け方を変えずに（TS 版と同じ）探索し直して、終わりに着けないことを確かめる
pub fn confirm_trap(m: &Model, prep: &Prep, e: &Engine, limit: usize) -> Confirm {
    use crate::flow::{analyze, FlowOptions};
    use crate::search::{explore_from, SearchOptions};
    let flow = analyze(
        m,
        FlowOptions {
            all: false,
            evidence: false,
        },
    );
    let so = SearchOptions {
        limit,
        progress: None,
        progress_every: usize::MAX,
    };
    match explore_from(m, &flow, prep, &so, e.clone(), true) {
        Ok(r) if r.goals.iter().any(|&g| g) => Confirm::Escaped(r.processed),
        Ok(r) if r.truncated => Confirm::Unknown(r.processed),
        Ok(r) => Confirm::Stuck(r.processed),
        Err(_) => Confirm::Unknown(0),
    }
}

/// 報告を JSON にする（TS 版の Finding と同じ形。kind・path はあるときだけ）
pub fn findings_json(f: &[Finding]) -> serde_json::Value {
    serde_json::Value::Array(f.iter().map(|f| {
        let mut o = serde_json::json!({ "severity": if f.error { "error" } else { "warning" }, "message": f.message });
        if let Some(s) = &f.scene { o["scene"] = s.clone().into(); }
        if let Some(k) = f.kind { o["kind"] = k.into(); }
        if let Some(p) = &f.path { o["path"] = p.clone().into(); }
        o
    }).collect())
}
