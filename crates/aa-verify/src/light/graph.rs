// 軽いチェックの流れのグラフ。命令・尋問の画面・探偵メニューを地点とし、行き先への辺に、通るための条件
// （条件式・持っている証拠品・相手がいること）を付ける。状態は区別しない。
use crate::model::*;

/// 辺を通るための条件と、報告に使う辺の種類
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Site {
    /// 止まらずに進む・移動する（条件なし）
    Plain,
    /// if（jumpUnless）の、条件が真の側（then）と偽の側（else）
    IfThen,
    IfElse,
    Choice,
    Statement,
    Talk,
    Examine,
    Move,
    /// 証拠品をつきつける（正解のブロックへ）
    Present,
    /// 証拠品を詳しく調べる
    Inspect,
}

#[derive(Clone, Debug)]
pub struct LEdge<'m> {
    pub to: u32,
    /// 真であるべき条件（IfElse では偽であるべき条件）
    pub cond: Option<&'m Expr>,
    pub site: Site,
    /// 持っている必要のある証拠品
    pub ev: Option<u32>,
    /// 相手（その場所にいる人物）が要る場所（シーンの番号）
    pub person: Option<u32>,
    /// 通ると付く調べた印
    pub seen: Option<u32>,
}

/// 地点での状態の変化
#[derive(Clone, Copy, Debug)]
pub enum Effect {
    None,
    Set(u32, FVal),
    Add(u32),
    Give(u32),
    Take(u32),
}

pub struct LGraph<'m> {
    pub nodes: usize,
    pub base: Vec<u32>,
    pub testimony: Vec<u32>,
    pub menu: Vec<u32>,
    /// 地点ごとのシーン
    pub scene_of: Vec<u32>,
    pub succ: Vec<Vec<LEdge<'m>>>,
    pub effect: Vec<Effect>,
    /// 詳しく調べるブロックの終わりの地点（シーンごと）
    pub inspect_end: Vec<Vec<u32>>,
    pub start: u32,
}

impl LGraph<'_> {
    /// シーンに入った所の地点（場所なら、来たときのブロックか探偵メニュー）
    pub fn entry(&self, m: &Model, id: u32) -> Option<u32> {
        let sc = m.scenes.get(id as usize)?;
        Some(match &sc.kind {
            Kind::Testimony(_) => self.testimony[id as usize],
            Kind::Place(p) => p.enter.map_or(self.menu[id as usize], |pc| self.base[id as usize] + pc),
            Kind::Dialogue => self.base[id as usize],
        })
    }
    /// シーンに着いたことになる地点（場所は探偵メニュー）
    pub fn arrive(&self, m: &Model, id: u32) -> Option<u32> {
        match m.scenes.get(id as usize)?.kind {
            Kind::Place(_) => Some(self.menu[id as usize]),
            _ => self.entry(m, id),
        }
    }
}

pub fn build(m: &Model) -> LGraph<'_> {
    let ns = m.scenes.len();
    let (mut base, mut testimony, mut menu) = (vec![0u32; ns], vec![u32::MAX; ns], vec![u32::MAX; ns]);
    let mut n = 0u32;
    for (i, sc) in m.scenes.iter().enumerate() { base[i] = n; n += sc.program.len() as u32; }
    for (i, sc) in m.scenes.iter().enumerate() {
        match sc.kind {
            Kind::Testimony(_) => { testimony[i] = n; n += 1; }
            Kind::Place(_) => { menu[i] = n; n += 1; }
            Kind::Dialogue => {}
        }
    }
    let nodes = n as usize;
    let mut g = LGraph {
        nodes, base, testimony, menu, scene_of: vec![0; nodes], succ: (0..nodes).map(|_| vec![]).collect(),
        effect: vec![Effect::None; nodes], inspect_end: vec![vec![]; ns], start: 0,
    };
    for (i, sc) in m.scenes.iter().enumerate() {
        for pc in 0..sc.program.len() { g.scene_of[g.base[i] as usize + pc] = i as u32; }
        for t in [g.testimony[i], g.menu[i]] { if t != u32::MAX { g.scene_of[t as usize] = i as u32; } }
    }
    let plain = |to: u32| LEdge { to, cond: None, site: Site::Plain, ev: None, person: None, seen: None };
    let inspects: Vec<(u32, u32)> = m.evidence.iter().enumerate().filter_map(|(x, e)| e.inspect.map(|s| (x as u32, s))).collect();
    // 法廷記録を開ける所（台詞・日時の表示・選択肢・証言・つきつけの要求・探偵メニュー）から、詳しく調べるシーンへ
    let inspect_edges = |g: &LGraph, out: &mut Vec<LEdge>| {
        for &(x, s) in &inspects { if let Some(to) = g.entry(m, s) { out.push(LEdge { site: Site::Inspect, ev: Some(x), ..plain(to) }); } }
    };
    for (si, sc) in m.scenes.iter().enumerate() {
        let b = g.base[si];
        let len = sc.program.len() as u32;
        for (pc, ins) in sc.program.iter().enumerate() {
            let pc = pc as u32;
            let node = (b + pc) as usize;
            let mut out: Vec<LEdge> = vec![];
            let next = (pc + 1 < len).then_some(b + pc + 1);
            match ins {
                Op::Jump(to) => out.push(plain(b + to)),
                Op::JumpUnless(c, to) => {
                    if let Some(nx) = next { out.push(LEdge { cond: Some(c), site: Site::IfThen, ..plain(nx) }); }
                    out.push(LEdge { cond: Some(c), site: Site::IfElse, ..plain(b + to) });
                }
                Op::Random(to) => { out.extend(to.iter().map(|t| plain(b + t))); if to.is_empty() { out.extend(next.map(plain)); } }
                Op::Choice(opts) => {
                    out.extend(opts.iter().map(|o| LEdge { cond: o.when.as_ref(), site: Site::Choice, ..plain(b + o.to) }));
                    inspect_edges(&g, &mut out);
                }
                Op::Stop(StopKind::Line | StopKind::Card) => { out.extend(next.map(plain)); inspect_edges(&g, &mut out); }
                Op::Demand { options, profiles, wrong, give_up, .. } => {
                    let all = options.iter().chain(profiles.iter().flatten());
                    out.extend(all.map(|(x, t)| LEdge { site: Site::Present, ev: Some(*x), ..plain(b + t) }));
                    out.push(plain(b + wrong));
                    if let Some(g) = give_up { out.push(plain(b + g)); }
                    inspect_edges(&g, &mut out);
                }
                Op::Goto(s) | Op::Investigate(s) => out.extend(g.entry(m, *s).map(plain)),
                Op::Menu => if g.menu[si] != u32::MAX { out.push(plain(g.menu[si])) },
                Op::Resume(_) => if g.testimony[si] != u32::MAX { out.push(plain(g.testimony[si])) },
                Op::End | Op::Gameover => {}
                Op::InspectEnd => g.inspect_end[si].push(b + pc),
                Op::Set(f, v) => { g.effect[node] = Effect::Set(*f, *v); out.extend(next.map(plain)); }
                Op::Add(f, _) => { g.effect[node] = Effect::Add(*f); out.extend(next.map(plain)); }
                Op::Give(x) => { g.effect[node] = Effect::Give(*x); out.extend(next.map(plain)); }
                Op::Take(x) => { g.effect[node] = Effect::Take(*x); out.extend(next.map(plain)); }
                _ => out.extend(next.map(plain)),
            }
            g.succ[node] = out;
        }
        match &sc.kind {
            Kind::Testimony(t) => {
                let node = g.testimony[si] as usize;
                let mut out = vec![];
                for st in &t.statements {
                    let w = st.when.as_ref();
                    for pc in st.press.iter().chain(st.before.iter()) { out.push(LEdge { cond: w, site: Site::Statement, ..plain(b + pc) }); }
                    out.extend(st.present.iter().chain(st.present_profile.iter().flatten()).map(|(x, pc)| LEdge { cond: w, site: Site::Present, ev: Some(*x), ..plain(b + pc) }));
                }
                out.extend([Some(t.wrong), t.after, t.reading, t.looping].into_iter().flatten().map(|pc| plain(b + pc)));
                inspect_edges(&g, &mut out);
                g.succ[node] = out;
            }
            Kind::Place(p) => {
                let node = g.menu[si] as usize;
                let s = Some(si as u32);
                let mut out = vec![];
                out.extend(p.examine.iter().map(|x| LEdge { cond: x.when.as_ref(), site: Site::Examine, seen: Some(x.seen), ..plain(b + x.pc) }));
                out.extend(p.talk.iter().map(|x| LEdge { cond: x.when.as_ref(), site: Site::Talk, seen: Some(x.seen), person: s, ..plain(b + x.pc) }));
                out.push(plain(b + p.examine_default));
                let all = p.present.iter().chain(&p.present_profile);
                out.extend(all.map(|(x, pc)| LEdge { site: Site::Present, ev: Some(*x), person: s, ..plain(b + pc) }));
                out.push(LEdge { person: s, ..plain(b + p.present_wrong) });
                for (to, w) in &p.moves { if let Some(e) = g.entry(m, *to) { out.push(LEdge { cond: w.as_ref(), site: Site::Move, ..plain(e) }); } }
                inspect_edges(&g, &mut out);
                g.succ[node] = out;
            }
            Kind::Dialogue => {}
        }
    }
    g.start = if g.testimony.get(m.start_scene as usize).is_some_and(|&t| t != u32::MAX) {
        g.testimony[m.start_scene as usize]
    } else {
        g.base.get(m.start_scene as usize).copied().unwrap_or(0)
    };
    g
}
