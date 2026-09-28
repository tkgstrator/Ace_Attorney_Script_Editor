// 整合性チェックで試す操作（verify.ts の actions と verify-inspect.ts と同じ並び・同じ選び方）と、
// 操作を 1 つ行って文章送りだけの場面をまとめて進める step。
use crate::engine::{BeatKind, Engine, Res};
use crate::flow::Flow;
use crate::inspect::{inspect_acts, linear, mark_inspect, may_stop_inspect};
use crate::model::*;
use crate::state::{Bits, Mode, State};

/// 操作
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Act {
    Advance,
    Press,
    /// 表示される選択肢の番号
    Choose(usize),
    Present(u32),
    Examine(i64, i64),
    Move(u32),
    /// 場所の talk の番号
    Talk(usize),
    /// 証拠品を詳しく調べて、表示される場所の選択肢の番号を選ぶ（選択肢がなければ None）
    Inspect(u32, Option<usize>),
}

impl Act {
    pub fn run(self, e: &mut Engine) -> Res {
        match self {
            Act::Advance => e.advance(),
            Act::Press => e.press(),
            Act::Choose(i) => e.choose(i),
            Act::Present(ev) => e.present(ev),
            Act::Examine(x, y) => e.examine(x, y),
            Act::Move(p) => e.move_to(p),
            Act::Talk(i) => e.talk(i),
            Act::Inspect(ev, n) => {
                e.inspect(ev)?;
                match n { Some(n) => e.choose(n), None => Ok(()) }
            }
        }
    }

    /// 操作の書き方（差分テストで TS 側と受け渡す）
    pub fn describe(self, m: &Model, e: &Engine) -> String {
        match self {
            Act::Advance => "a".into(),
            Act::Press => "p".into(),
            Act::Choose(i) => format!("c{i}"),
            Act::Present(ev) => format!("{}{}", if m.is_profile(ev) { 'r' } else { 'v' }, m.evidence[ev as usize].id),
            Act::Examine(x, y) => format!("e{x},{y}"),
            Act::Move(p) => format!("m{}", m.scene_name(p)),
            Act::Talk(i) => format!("t{}", m.seen_ids[e.place().map(|p| p.talk[i].seen).unwrap_or(0) as usize]),
            Act::Inspect(ev, Some(n)) => format!("i{}:{n}", m.evidence[ev as usize].id),
            Act::Inspect(ev, None) => format!("i{}", m.evidence[ev as usize].id),
        }
    }
}

const SCREEN_W: i64 = 256;
const SCREEN_H: i64 = 192;

/// 場所で試す「調べる」の点（背景の座標。範囲の辺で区切った升目のうち、どの範囲に入るかの組み合わせごとに 1 点）。
/// 背景の大きさは分からないので、画面の大きさと範囲の右・下の端のうち大きい方までを背景とみなす（verify-actions.ts と同じ）
pub fn examine_points(p: &Place) -> Vec<(i64, i64)> {
    let cut = |lo: Vec<i64>, max: i64| {
        let mut v: Vec<i64> = std::iter::once(0).chain(lo).filter(|&v| v >= 0 && v < max).collect();
        v.sort_unstable();
        v.dedup();
        v
    };
    let max_x = p.examine.iter().map(|e| e.area[0] + e.area[2]).fold(SCREEN_W, i64::max);
    let max_y = p.examine.iter().map(|e| e.area[1] + e.area[3]).fold(SCREEN_H, i64::max);
    let xs = cut(p.examine.iter().flat_map(|e| [e.area[0], e.area[0] + e.area[2]]).collect(), max_x);
    let ys = cut(p.examine.iter().flat_map(|e| [e.area[1], e.area[1] + e.area[3]]).collect(), max_y);
    let mut pts = vec![];
    let mut sigs: Vec<Vec<bool>> = vec![];
    for &y in &ys {
        for &x in &xs {
            let sig: Vec<bool> = p.examine.iter().map(|e| {
                let [ax, ay, w, h] = e.area;
                x >= ax && x < ax + w && y >= ay && y < ay + h
            }).collect();
            if !sigs.contains(&sig) { sigs.push(sig); pts.push((x, y)); }
        }
    }
    pts
}

/// 探偵メニューの状態で、「調べる」の点ごとの結果を決める、調べる所の条件の値（状態ごとに 1 回だけ求める）
pub struct ExamineHits(Vec<Result<bool, String>>);

impl ExamineHits {
    pub fn new(e: &Engine) -> Option<ExamineHits> {
        let p = e.place().ok()?;
        if e.s.mode != Mode::Investigate { return None; }
        Some(ExamineHits(p.examine.iter().map(|x| e.test(x.when.as_ref())).collect()))
    }
    /// 点 (x, y) で当たる調べる所（core と同じく、条件は前から順に、範囲より先に調べる）
    pub fn hit(&self, p: &Place, x: i64, y: i64) -> Res<Option<usize>> {
        for (i, ex) in p.examine.iter().enumerate() {
            let [ax, ay, w, h] = ex.area;
            if *self.0[i].as_ref().map_err(Clone::clone)? && x >= ax && x < ax + w && y >= ay && y < ay + h { return Ok(Some(i)); }
        }
        Ok(None)
    }
}

/// 場所ごとの下ごしらえ
pub struct Prep {
    /// 場所の「調べる」の点（シーンの番号ごと）
    pub points: Vec<Vec<(i64, i64)>>,
}

impl Prep {
    pub fn new(m: &Model) -> Prep {
        Prep { points: m.scenes.iter().map(|s| s.place().map(examine_points).unwrap_or_default()).collect() }
    }
}

/// 今の場面で選べる操作。passed には、調べられる（入れる）詳しく調べるシーンを記録する
pub fn actions(e: &Engine, prep: &Prep, passed: Option<&mut Bits>) -> Res<Vec<Act>> {
    let m = e.m;
    let s = &e.s;
    let b = e.beat()?;
    // 証拠品の正解と見当違い 1 つ、人物ファイルもつきつけられるならその正解と見当違い 1 つ
    // （見当違いは証拠品から選び、証拠品がすべて正解のときだけ人物ファイルから選ぶ）
    let present = |answers: &[(u32, u32)], profiles: Option<&[(u32, u32)]>, out: &mut Vec<Act>| {
        let is_answer = |list: &[(u32, u32)], ev: u32| list.iter().any(|(a, _)| *a == ev);
        let evs = || s.evidence.iter().copied().filter(|&x| !m.is_profile(x));
        let wrong = evs().find(|&ev| !is_answer(answers, ev));
        out.extend(evs().filter(|&ev| is_answer(answers, ev) || Some(ev) == wrong).map(Act::Present));
        let Some(pa) = profiles else { return };
        let held = || s.evidence.iter().copied().filter(|&x| m.is_profile(x));
        let wrong_profile = if wrong.is_none() { held().find(|&x| !is_answer(pa, x)) } else { None };
        out.extend(held().filter(|&x| is_answer(pa, x) || Some(x) == wrong_profile).map(Act::Present));
    };
    let mut inspect = if e.can_inspect_at(b) { inspect_acts(m, s, e.inspectable(), passed) } else { vec![] };
    let mut out = vec![];
    match b {
        BeatKind::Line | BeatKind::Card => { out.push(Act::Advance); out.append(&mut inspect); }
        BeatKind::Shout | BeatKind::Banner | BeatKind::Fade | BeatKind::Wait => out.push(Act::Advance),
        BeatKind::Choice => {
            let Op::Choice(opts) = e.instr()? else { unreachable!() };
            let mut n = 0;
            for o in opts { if e.test(o.when.as_ref())? { out.push(Act::Choose(n)); n += 1; } }
            out.append(&mut inspect);
        }
        BeatKind::Demand => {
            let Op::Demand { options, profiles, .. } = e.instr()? else { unreachable!() };
            present(options, profiles.as_deref(), &mut out);
            out.append(&mut inspect);
        }
        BeatKind::Statement { cross } => {
            out.push(Act::Advance);
            if cross {
                let st = e.testimony()?.statements.get(s.statement as usize);
                if st.is_some_and(|st| st.press.is_some()) { out.push(Act::Press); }
                present(st.map_or(&[][..], |st| &st.present), None, &mut out);
            }
            out.append(&mut inspect);
        }
        BeatKind::Investigate => {
            let p = e.place()?;
            out.extend(prep.points[s.scene as usize].iter().map(|&(x, y)| Act::Examine(x, y)));
            out.extend(e.moves()?.into_iter().map(Act::Move));
            out.extend(e.talks()?.into_iter().map(Act::Talk));
            if e.person_here(p)? { present(&p.present, Some(&p.present_profile), &mut out); }
            out.append(&mut inspect);
        }
        BeatKind::End | BeatKind::Gameover => {}
    }
    Ok(out)
}

pub(crate) const CHAIN_LIMIT: usize = 10_000;
const MERGE_RATIO: usize = 2;

/// キーに入る変数の数（詳しく調べている途中なら、戻り先で生きている変数も数える）
pub fn live_count(flow: &Flow, s: &State) -> usize {
    let mut n = flow.live(flow.node_of(s.scene, s.pc, s.mode)).len();
    if let Some(f) = s.inspect_from { n += flow.live(flow.node_of(f.scene, f.pc, f.mode)).len(); }
    n
}

/// 文章送りだけの場面をまとめて進めるのを、どこで止めるか
#[derive(Clone, Copy)]
pub enum Stop<'a> {
    /// verify.ts と同じ: 別のシーンに入って、生きている変数が大きく減った所
    Merge(&'a Flow),
    /// 編ごとに調べるとき: 別の編のシーンに入った所（part_of はシーンごとの編の番号。NO_PART は編に入らないシーン）
    Part { part_of: &'a [u16], part: u16 },
}

pub const NO_PART: u16 = u16::MAX;

/// 操作を 1 つ行い、続く「文章送りだけの場面」をまとめて進める（verify.ts の step）。
/// 止まるのは、選ぶ場面に着いたときと、stop の所
/// 返す値は、操作の後に続けた文章送りの数
pub fn step(stop: Stop, e: &mut Engine, act: Act, passed: Option<&mut Bits>) -> Res<usize> {
    step_run(stop, e, |e| act.run(e), passed)
}

/// step の、操作を関数で渡す形
pub fn step_run(stop: Stop, e: &mut Engine, act: impl FnOnce(&mut Engine) -> Res, mut passed: Option<&mut Bits>) -> Res<usize> {
    let mut scene = e.s.scene;
    let live = match stop { Stop::Merge(flow) => live_count(flow, &e.s), Stop::Part { .. } => 0 };
    act(e)?;
    let mut n = 0;
    while n < CHAIN_LIMIT && linear(e) {
        if e.s.scene != scene {
            scene = e.s.scene;
            match stop {
                Stop::Merge(flow) => if live_count(flow, &e.s) * MERGE_RATIO < live { break },
                Stop::Part { part_of, part } => {
                    let q = part_of.get(scene as usize).copied().unwrap_or(NO_PART);
                    if q != NO_PART && q != part { break; }
                }
            }
        }
        // 台詞などが続くだけの所は、最後の 1 つまで飛ばす（途中の文章送りは、同じシーンの中で何も変えない）。
        // 詳しく調べるために止まりうるとき（状態を変えうる証拠品を持っていて、法廷記録を開ける）は、最後の台詞・
        // 日時の表示まで飛ばし、そこで止まるかを見直す（途中の台詞は、調べるのを後に回せるので止まらない）
        let (skip, recheck) = if e.s.mode == Mode::Run {
            let sc = &e.m.scenes[e.s.scene as usize];
            let (last, count) = sc.stop_run[e.s.pc as usize];
            if !may_stop_inspect(e.m, &e.s) {
                ((count > 1 && n + count as usize <= CHAIN_LIMIT).then_some((last, count)), false)
            } else {
                // 最後の台詞・日時の表示と、そこまでに飛ばす止まる命令の数
                let rec = |pc: u32| matches!(sc.program[pc as usize], Op::Stop(StopKind::Line | StopKind::Card));
                let to = (e.s.pc + 1..=last).rev().find(|&pc| rec(pc));
                let k = to.map_or(0, |to| (e.s.pc..to).filter(|&pc| matches!(sc.program[pc as usize], Op::Stop(_))).count());
                match to { Some(to) if n + k <= CHAIN_LIMIT => (Some((to, k as u32 + 1)), true), _ => (None, false) }
            }
        } else { (None, false) };
        // 止まった場面のシーンを記録する（探索編の場所は、探偵メニューに着くまで visited に残らないため）。
        // 法廷記録を開けるなら、詳しく調べられるシーンも記録する
        if let Some(p) = passed.as_deref_mut() {
            if (scene as usize) < e.m.scenes.len() { p.add(scene); }
            mark_inspect(e.m, &e.s, p, skip.map_or(e.s.pc, |(last, _)| last));
        }
        if let Some((last, count)) = skip {
            e.s.pc = last;
            n += count as usize - 1;
            if recheck { continue; }
        }
        e.advance()?;
        n += 1;
    }
    Ok(n)
}
