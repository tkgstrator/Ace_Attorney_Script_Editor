// 網羅的な探索（verify.ts の verifyScenario の探索の部分）。エンジンで選べる操作をすべて試し、たどり着ける状態を
// 深さ優先で網羅する。状態は見つけた順に番号を付け、展開を待つ間は詰めて持ち、展開し終えたら捨てる
// （キーのハッシュ値と、親・辺だけを残す。詰みの説明は、最初の状態から操作をたどり直して作る）。
use crate::actions::{actions, step, step_run, Act, ExamineHits, Prep, Stop};
use crate::engine::{BeatKind, Engine};
use crate::flow::Flow;
use crate::graph::Graph;
use crate::key::KeyMaker;
use crate::model::Model;
use crate::state::{pack, unpack, Bits};
use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

/// キーはすでにハッシュ値なので、そのまま使う
#[derive(Default)]
pub struct IdHasher(u64);

impl Hasher for IdHasher {
    fn finish(&self) -> u64 { self.0 }
    fn write(&mut self, _: &[u8]) { unreachable!() }
    fn write_u128(&mut self, x: u128) { self.0 = x as u64; }
}

pub type KeyMap<V = u32> = HashMap<u128, V, BuildHasherDefault<IdHasher>>;

pub struct SearchOptions {
    pub limit: usize,
    /// 途中経過を、およそ every 個ごとに知らせる
    pub progress: Option<Box<dyn Fn(usize, usize)>>,
    pub progress_every: usize,
}

/// 探索の結果
pub struct Search {
    pub states: usize,
    pub processed: usize,
    pub truncated: bool,
    pub cleared: bool,
    pub graph: Graph,
    pub parent: Vec<u32>,
    pub via: Vec<u32>,
    pub ranks: Vec<u8>,
    pub goals: Vec<bool>,
    /// 通ったシーン（visited の番号）・調べた印
    pub visited: Bits,
    pub seen: Bits,
    /// 実行中のエラー（文, シーン）。同じ文は 1 回だけ
    pub crashes: Vec<(String, u32)>,
    /// 展開を待つ状態が最も多かったとき
    pub peak_pending: usize,
    pub peak_pending_bytes: usize,
    /// シーンごとの、展開した状態の数（どこで状態が増えているかを見るため）
    pub per_scene: Vec<u32>,
}

pub const NO_PARENT: u32 = u32::MAX;

/// 詰みの説明に使う場面の優先度（小さいほど、プレイヤーが止まっている理由を表しやすい）
pub fn rank(b: BeatKind) -> u8 {
    match b {
        BeatKind::Demand => 0,
        BeatKind::Statement { .. } => 1,
        BeatKind::Investigate => 2,
        BeatKind::Choice | BeatKind::Pick => 3,
        _ => 4,
    }
}

pub fn explore(m: &Model, flow: &Flow, prep: &Prep, opts: &SearchOptions) -> Result<Search, String> {
    let first = Engine::new(m).map_err(|e| format!("始めの状態を作れません: {e}"))?;
    explore_from(m, flow, prep, opts, first, false)
}

/// first から探索する。until_goal なら、終わり（end・gameover）に着いたところでやめる（詰みの確かめ用）
pub fn explore_from(m: &Model, flow: &Flow, prep: &Prep, opts: &SearchOptions, first: Engine, until_goal: bool) -> Result<Search, String> {
    let keys = KeyMaker::new(m, flow);
    let mut ids = KeyMap::default();
    let mut stack: Vec<(u32, Box<[u8]>)> = vec![];
    let mut stack_bytes = 0usize;
    let mut r = Search {
        states: 0, processed: 0, truncated: false, cleared: false, graph: Graph::default(), parent: vec![], via: vec![],
        ranks: vec![], goals: vec![], visited: Bits::new(m.visit_count()), seen: Bits::new(m.seen_ids.len()), crashes: vec![],
        peak_pending: 0, peak_pending_bytes: 0, per_scene: vec![0; m.scenes.len()],
    };

    or_into(&mut r.visited, &first.s.visited);
    r.visited.add(first.s.scene);
    ids.insert(keys.key(&first.s), 0);
    let b = pack(&first.s);
    stack_bytes += b.len();
    stack.push((0, b));
    r.parent.push(NO_PARENT);
    r.via.push(0);

    while let Some((i, bytes)) = stack.pop() {
        if r.processed >= opts.limit { r.truncated = true; break; }
        if let Some(p) = &opts.progress { if r.processed % opts.progress_every == 0 { p(r.processed, ids.len()); } }
        r.processed += 1;
        stack_bytes -= bytes.len();
        let e = Engine::load(m, unpack(&bytes, m));
        drop(bytes);
        r.graph.open(i);
        if let Some(c) = r.per_scene.get_mut(e.s.scene as usize) { *c += 1; }
        let b = match e.beat() {
            Ok(b) => b,
            Err(msg) => { crash(&mut r, msg, e.s.scene); continue; }
        };
        set_at(&mut r.ranks, i, rank(b), 4);
        if matches!(b, BeatKind::End | BeatKind::Gameover) {
            set_at(&mut r.goals, i, true, false);
            if b == BeatKind::End { r.cleared = true; }
            if until_goal { break; }
            continue;
        }
        let acts = match actions(&e, prep, Some(&mut r.visited)) {
            Ok(a) => a,
            Err(msg) => { crash(&mut r, msg, e.s.scene); continue; }
        };
        // 「調べる」は、当たる調べる所が同じなら結果も同じなので、1 回だけ実行する
        let mut examined: Vec<(Option<usize>, u32)> = vec![];
        let mut x = e.clone();
        let hits = ExamineHits::new(&e);
        for (a, act) in acts.iter().enumerate() {
            let hit = match (act, &hits) { (Act::Examine(x, y), Some(h)) => h.hit(e.place().unwrap(), *x, *y).ok(), _ => None };
            if let Some(&(_, t)) = hit.and_then(|h| examined.iter().find(|(k, _)| *k == h)) { r.graph.add(i, t); continue; }
            x.s.copy_from(&e.s);
            let run = |x: &mut Engine| match hit { Some(h) => x.examine_known(h), None => act.run(x) };
            if let Err(msg) = step_run(Stop::Merge(flow), &mut x, run, Some(&mut r.visited)) {
                crash(&mut r, msg, e.s.scene);
                continue;
            }
            // 通ったシーン・調べた印を記録する（キーが同じで展開しない状態の通り道も数える）
            or_into(&mut r.visited, &x.s.visited);
            or_into(&mut r.seen, &x.s.seen);
            if (x.s.scene as usize) < m.scenes.len() { r.visited.add(x.s.scene); }
            let k = keys.key(&x.s);
            let next = ids.len() as u32;
            let id = *ids.entry(k).or_insert_with(|| {
                let b = pack(&x.s);
                stack_bytes += b.len();
                stack.push((next, b));
                r.parent.push(i);
                r.via.push(a as u32);
                next
            });
            r.graph.add(i, id);
            if let Some(h) = hit { examined.push((h, id)); }
        }
        if stack.len() > r.peak_pending { r.peak_pending = stack.len(); }
        if stack_bytes > r.peak_pending_bytes { r.peak_pending_bytes = stack_bytes; }
    }
    r.states = if r.truncated { r.processed } else { ids.len() };
    let n = ids.len();
    r.ranks.resize(n, 4);
    r.goals.resize(n, false);
    Ok(r)
}

fn crash(r: &mut Search, msg: String, scene: u32) {
    let msg = format!("実行中にエラーになりました: {msg}");
    if !r.crashes.iter().any(|(m, _)| *m == msg) { r.crashes.push((msg, scene)); }
}

fn set_at<T: Copy>(v: &mut Vec<T>, i: u32, x: T, fill: T) {
    if v.len() <= i as usize { v.resize(i as usize + 1, fill); }
    v[i as usize] = x;
}

pub fn or_into(a: &mut Bits, b: &Bits) {
    for (x, y) in a.0.iter_mut().zip(b.0.iter()) { *x |= *y; }
}

/// 状態 id を、最初の状態から操作をたどり直して作る。stop_of(id) は、状態 id から進めるときの止め方
pub fn rebuild<'m, 'a>(m: &'m Model, stop_of: impl Fn(u32) -> Stop<'a>, prep: &Prep, r: &Search, id: u32) -> Result<Engine<'m>, String> {
    rebuild_ops(m, stop_of, prep, r, id, None)
}

/// rebuild と同じ。ops があれば、エンジンの操作の列（Act::describe の書き方。文章送りは "a"）を記録する
pub fn rebuild_ops<'m, 'a>(m: &'m Model, stop_of: impl Fn(u32) -> Stop<'a>, prep: &Prep, r: &Search, id: u32, mut ops: Option<&mut Vec<String>>) -> Result<Engine<'m>, String> {
    let mut path = vec![];
    let mut x = id;
    while r.parent[x as usize] != NO_PARENT {
        path.push((r.parent[x as usize], r.via[x as usize]));
        x = r.parent[x as usize];
    }
    let mut e = Engine::new(m)?;
    for (from, a) in path.into_iter().rev() {
        let act: Act = actions(&e, prep, None)?[a as usize];
        if let Some(o) = ops.as_deref_mut() { o.push(act.describe(m, &e)); }
        let n = step(stop_of(from), &mut e, act, None)?;
        if let Some(o) = ops.as_deref_mut() { o.extend(std::iter::repeat_n("a".to_string(), n)); }
    }
    Ok(e)
}
