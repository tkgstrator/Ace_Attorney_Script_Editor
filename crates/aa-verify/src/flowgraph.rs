// 流れのグラフの組み立て（verify-flow.ts の analyzeFlow の前半）。命令・尋問の画面・探偵メニューを地点とし、
// 行き先を辺にする。地点ごとに、読む変数（gen）・必ず書く変数（def）と、証拠品の読み書きも集める。
use crate::model::*;
use crate::region::{boolean_flags, expr_deps, expr_deps_with_evidence, refs, summarize, Name};
use std::collections::HashMap;

/// キーに入りうる変数（式で読まれる、フラグ・visited・seen）
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Var {
    Flag(u32),
    Visit(u32),
    Seen(u32),
}

/// 流れのグラフの辺。kill は辺を通るときに必ず書き込まれる変数（入った場所の visited・調べた印の seen）。
/// ev は、証拠品を詳しく調べる辺のときの証拠品（その証拠品を持っているときだけ通れる。ほかは NO_EV）
#[derive(Clone)]
pub struct Edge {
    pub to: u32,
    pub kill: i64,
    pub ev: u32,
}

pub const NO_EV: u32 = u32::MAX;

/// 組み立てた流れのグラフ
#[derive(Clone)]
pub struct Built {
    pub base: Vec<u32>,
    pub testimony: Vec<u32>,
    pub menu: Vec<u32>,
    pub nodes: usize,
    pub vars: Vec<Var>,
    pub succ: Vec<Vec<Edge>>,
    pub gen: Vec<Vec<u32>>,
    pub def: Vec<Vec<u32>>,
    /// 地点で読む証拠品（has の条件・つきつけの正解・詳しく調べられる証拠品）と、書く証拠品（give / take）
    pub ev_gen: Vec<Vec<u32>>,
    pub ev_def: Vec<Vec<u32>>,
    /// つきつけられる地点と、そこでの正解（尋問は証言ごと。人物ファイルの正解も含む）と、人物ファイルもつきつけられるか。
    /// 見当違いのつきつけができるかに、持っている証拠品が効く
    pub present_points: Vec<(u32, Vec<Vec<u32>>, bool)>,
    /// 地点ごとの証拠品の変化（give は true、take は false）
    pub ev_effect: Vec<Option<(u32, bool)>>,
    /// まとめた if のかたまりの中の、通るかもしれない人物ファイルの出し入れ（かたまりの入りの地点に置く）
    pub ev_maybe: Vec<Vec<(u32, bool)>>,
    /// 詳しく調べるブロックの終わり（地点, シーン）
    pub inspect_end: Vec<(u32, u32)>,
    /// 始めの地点
    pub start: u32,
}

/// 式で読まれる変数（ライフと証拠品は除く）
fn expr_vars(e: Option<&Expr>, out: &mut Vec<Name>) {
    if let Some(e) = e { refs(e, out); }
}

/// 流れのグラフを組み立てる（verify-flow.ts の analyzeFlow の前半）
pub fn build(m: &Model) -> Built {
    let ns = m.scenes.len();
    let mut base = vec![0u32; ns];
    let mut n = 0u32;
    for (i, sc) in m.scenes.iter().enumerate() { base[i] = n; n += sc.program.len() as u32; }
    let (mut testimony, mut menu) = (vec![u32::MAX; ns], vec![u32::MAX; ns]);
    for (i, sc) in m.scenes.iter().enumerate() {
        match sc.kind {
            Kind::Testimony(_) => { testimony[i] = n; n += 1; }
            Kind::Place(_) => { menu[i] = n; n += 1; }
            Kind::Dialogue => {}
        }
    }
    let nodes = n as usize;

    // 変数に番号を付ける（式で読まれている変数だけ）
    let mut names: Vec<Name> = vec![];
    {
        let mut c = |e: Option<&Expr>| expr_vars(e, &mut names);
        for sc in &m.scenes {
            for ins in &sc.program {
                match ins {
                    Op::JumpUnless(e, _) => c(Some(e)),
                    Op::Choice(o) => o.iter().for_each(|o| c(o.when.as_ref())),
                    _ => {}
                }
            }
            match &sc.kind {
                Kind::Testimony(t) => t.statements.iter().for_each(|s| c(s.when.as_ref())),
                Kind::Place(p) => {
                    p.person.iter().for_each(|w| c(w.as_ref()));
                    p.moves.iter().for_each(|(_, w)| c(w.as_ref()));
                    p.talk.iter().for_each(|t| c(t.when.as_ref()));
                    p.examine.iter().for_each(|x| c(x.when.as_ref()));
                }
                Kind::Dialogue => {}
            }
        }
    }
    let vars: Vec<Var> = names.iter().filter_map(|n| match n {
        Name::Flag(f) => Some(Var::Flag(*f)),
        Name::Visit(v) => Some(Var::Visit(*v)),
        Name::Seen(s) => Some(Var::Seen(*s)),
        _ => None,
    }).collect();
    let index: HashMap<Var, u32> = vars.iter().enumerate().map(|(i, v)| (*v, i as u32)).collect();
    let id_of = |n: Name| -> i64 {
        let v = match n { Name::Flag(f) => Var::Flag(f), Name::Visit(v) => Var::Visit(v), Name::Seen(s) => Var::Seen(s), _ => return -1 };
        index.get(&v).map_or(-1, |&i| i64::from(i))
    };

    let bool_flags = boolean_flags(m);
    let mut gen: Vec<Vec<u32>> = vec![vec![]; nodes];
    let mut def: Vec<Vec<u32>> = vec![vec![]; nodes];
    let mut succ: Vec<Vec<Edge>> = (0..nodes).map(|_| vec![]).collect();
    let mut ev_gen: Vec<Vec<u32>> = vec![vec![]; nodes];
    let mut ev_def: Vec<Vec<u32>> = vec![vec![]; nodes];
    let mut ev_effect: Vec<Option<(u32, bool)>> = vec![None; nodes];
    let mut ev_maybe: Vec<Vec<(u32, bool)>> = vec![vec![]; nodes];
    let mut present_points: Vec<(u32, Vec<Vec<u32>>, bool)> = vec![];
    let mut inspect_end = vec![];
    // 条件で読む変数（フラグは verify-flow.ts と同じ。証拠品は別に集める）
    let uses = |gen: &mut Vec<Vec<u32>>, ev_gen: &mut Vec<Vec<u32>>, node: u32, e: Option<&Expr>| {
        for v in expr_deps(e, &bool_flags, m) { let i = id_of(v); if i >= 0 { gen[node as usize].push(i as u32); } }
        for v in expr_deps_with_evidence(e, &bool_flags, m) { if let Name::Has(x) = v { ev_gen[node as usize].push(x); } }
    };
    let entry = |id: u32| -> (Option<u32>, i64) {
        let Some(sc) = m.scenes.get(id as usize) else { return (None, -1) };
        match &sc.kind {
            Kind::Testimony(_) => (Some(testimony[id as usize]), id_of(Name::Visit(id))),
            Kind::Place(p) => match p.enter {
                Some(pc) => (Some(base[id as usize] + pc), -1),
                None => (Some(menu[id as usize]), id_of(Name::Visit(id))),
            },
            Kind::Dialogue => (Some(base[id as usize]), id_of(Name::Visit(id))),
        }
    };
    let edge = |succ: &mut Vec<Vec<Edge>>, from: u32, to: Option<u32>, kill: i64| {
        if let Some(to) = to { succ[from as usize].push(Edge { to, kill, ev: NO_EV }); }
    };
    let enter = |succ: &mut Vec<Vec<Edge>>, from: u32, id: u32| { let (to, kill) = entry(id); edge(succ, from, to, kill); };
    // 証拠品を詳しく調べられる所（つきつけの要求・探偵メニュー）から、調べるシーンへの辺（証拠品ごと）
    let inspect_ev: Vec<(u32, u32)> = m.evidence.iter().enumerate().filter_map(|(i, ev)| ev.inspect.map(|s| (i as u32, s))).collect();
    let inspects = |succ: &mut Vec<Vec<Edge>>, ev_gen: &mut Vec<Vec<u32>>, from: u32| {
        for &(ev, id) in &inspect_ev {
            let (to, kill) = entry(id);
            if let Some(to) = to { succ[from as usize].push(Edge { to, kill, ev }); }
            ev_gen[from as usize].push(ev);
        }
    };
    // 台詞・日時の表示・選択肢・証言の途中から、調べて状態が変わりうる証拠品のシーンへの辺（verify-flow.ts の inspectsAnywhere）
    let anywhere = |succ: &mut Vec<Vec<Edge>>, ev_gen: &mut Vec<Vec<u32>>, from: u32| {
        for &ev in &m.inspect_effective {
            let (to, kill) = entry(m.evidence[ev as usize].inspect.unwrap());
            if let Some(to) = to { succ[from as usize].push(Edge { to, kill, ev }); }
            ev_gen[from as usize].push(ev);
        }
    };
    let record_stop = |op: &Op| matches!(op, Op::Stop(StopKind::Line | StopKind::Card));

    for (si, sc) in m.scenes.iter().enumerate() {
        let b = base[si];
        let len = sc.program.len() as u32;
        for (pc, ins) in sc.program.iter().enumerate() {
            let pc = pc as u32;
            let node = b + pc;
            let next = if pc + 1 < len { Some(node + 1) } else { None };
            match ins {
                Op::Jump(to) => edge(&mut succ, node, Some(b + to), -1),
                Op::JumpUnless(c, to) => match summarize(&sc.program, pc, &bool_flags, m) {
                    // 止まって選ぶ場面のない if のかたまりは、出口への 1 本の辺にまとめる
                    Some(sum) => {
                        ev_gen[node as usize].extend(sum.has);
                        ev_maybe[node as usize] = sum.maybe;
                        for v in sum.gen { let i = id_of(v); if i >= 0 { gen[node as usize].push(i as u32); } }
                        for v in sum.def { let i = id_of(v); if i >= 0 { def[node as usize].push(i as u32); } }
                        edge(&mut succ, node, Some(b + sum.exit), -1);
                        // かたまりの中の台詞・日時の表示で詳しく調べられる
                        if sc.program[pc as usize..sum.exit as usize].iter().any(record_stop) { anywhere(&mut succ, &mut ev_gen, node); }
                    }
                    None => {
                        uses(&mut gen, &mut ev_gen, node, Some(c));
                        edge(&mut succ, node, next, -1);
                        edge(&mut succ, node, Some(b + to), -1);
                    }
                },
                Op::Random(to) => {
                    to.iter().for_each(|t| edge(&mut succ, node, Some(b + t), -1));
                    if to.is_empty() { edge(&mut succ, node, next, -1); }
                }
                Op::Choice(opts) => {
                    for o in opts { uses(&mut gen, &mut ev_gen, node, o.when.as_ref()); edge(&mut succ, node, Some(b + o.to), -1); }
                    anywhere(&mut succ, &mut ev_gen, node);
                }
                Op::Stop(_) if record_stop(ins) => { edge(&mut succ, node, next, -1); anywhere(&mut succ, &mut ev_gen, node); }
                Op::Demand { options, profiles, wrong, .. } => {
                    let all = options.iter().chain(profiles.iter().flatten());
                    all.clone().for_each(|(_, t)| edge(&mut succ, node, Some(b + t), -1));
                    edge(&mut succ, node, Some(b + wrong), -1);
                    inspects(&mut succ, &mut ev_gen, node);
                    let answers: Vec<u32> = all.map(|(x, _)| *x).collect();
                    ev_gen[node as usize].extend(&answers);
                    present_points.push((node, vec![answers], profiles.is_some()));
                }
                Op::Goto(s) | Op::Investigate(s) => enter(&mut succ, node, *s),
                Op::Menu => { let to = menu[si]; edge(&mut succ, node, (to != u32::MAX).then_some(to), id_of(Name::Visit(si as u32))) }
                Op::Resume(_) => { let to = testimony[si]; edge(&mut succ, node, (to != u32::MAX).then_some(to), -1) }
                Op::InspectEnd => inspect_end.push((node, si as u32)),
                Op::End | Op::Gameover => {}
                Op::Give(x) | Op::Take(x) => {
                    ev_def[node as usize].push(*x);
                    ev_effect[node as usize] = Some((*x, matches!(ins, Op::Give(_))));
                    edge(&mut succ, node, next, -1);
                }
                Op::Set(f, _) => {
                    let i = id_of(Name::Flag(*f));
                    if i >= 0 { def[node as usize].push(i as u32); }
                    edge(&mut succ, node, next, -1);
                }
                _ => edge(&mut succ, node, next, -1),
            }
        }
        match &sc.kind {
            Kind::Testimony(t) => {
                let node = testimony[si];
                let mut points = vec![];
                for st in &t.statements {
                    uses(&mut gen, &mut ev_gen, node, st.when.as_ref());
                    let answers: Vec<u32> = st.present.iter().map(|(x, _)| *x).collect();
                    ev_gen[node as usize].extend(&answers);
                    points.push(answers);
                    for pc in st.press.iter().chain(st.before.iter()).chain(st.present.iter().map(|(_, p)| p)) {
                        edge(&mut succ, node, Some(b + pc), -1);
                    }
                }
                for pc in [Some(t.wrong), t.after, t.reading, t.looping].into_iter().flatten() { edge(&mut succ, node, Some(b + pc), -1); }
                anywhere(&mut succ, &mut ev_gen, node);
                present_points.push((node, points, false));
            }
            Kind::Place(p) => {
                let node = menu[si];
                p.person.iter().for_each(|w| uses(&mut gen, &mut ev_gen, node, w.as_ref()));
                for x in &p.examine { uses(&mut gen, &mut ev_gen, node, x.when.as_ref()); edge(&mut succ, node, Some(b + x.pc), id_of(Name::Seen(x.seen))); }
                for x in &p.talk { uses(&mut gen, &mut ev_gen, node, x.when.as_ref()); edge(&mut succ, node, Some(b + x.pc), id_of(Name::Seen(x.seen))); }
                edge(&mut succ, node, Some(b + p.examine_default), -1);
                let all = p.present.iter().chain(&p.present_profile);
                for pc in all.clone().map(|(_, pc)| *pc).chain([p.present_wrong]) { edge(&mut succ, node, Some(b + pc), -1); }
                for (to, w) in &p.moves { uses(&mut gen, &mut ev_gen, node, w.as_ref()); enter(&mut succ, node, *to); }
                inspects(&mut succ, &mut ev_gen, node);
                let answers: Vec<u32> = all.map(|(x, _)| *x).collect();
                ev_gen[node as usize].extend(&answers);
                present_points.push((node, vec![answers], true));
            }
            Kind::Dialogue => {}
        }
    }

    // 始めの地点（エンジンは始めのシーンに pc 0 で入る）
    let s0 = m.start_scene as usize;
    let start = if testimony.get(s0).is_some_and(|&t| t != u32::MAX) { testimony[s0] } else { base.get(s0).copied().unwrap_or(0) };
    Built { base, testimony, menu, nodes, vars, succ, gen, def, ev_gen, ev_def, present_points, ev_effect, ev_maybe, inspect_end, start }
}
