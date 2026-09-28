// 流れの解析（verify-flow.ts と同じ）: シナリオの流れ（命令・尋問・探偵メニューのつながり）を 1 つのグラフにして、
// 各地点で「この先で値を読むかもしれない変数」（生きている変数）を求める。
// 状態を見分けるキーには、今いる地点で生きている変数だけを入れる（死んでいる変数の値が違うだけの状態は、
// この先の動きがまったく同じなので、まとめても詰みの判定は変わらない）。
use crate::evflow;
use crate::flowgraph::{build, Built};
pub use crate::flowgraph::{Edge, Var};
use crate::model::*;
use crate::state::Mode;

/// 流れの解析の選び方
#[derive(Clone, Copy, Debug)]
pub struct FlowOptions {
    /// 生きているかを調べず、式で読まれる変数をすべての地点で生きているとみなす（確かめ用）
    pub all: bool,
    /// 証拠品も生きているものだけをキーに入れ、持てない証拠品を詳しく調べる辺を除く（TS 版にない工夫）
    pub evidence: bool,
}

pub struct Flow {
    /// シーンの命令の地点の番号 = base[シーン] + pc
    pub base: Vec<u32>,
    /// 尋問の画面・探偵メニューの地点（シーンの番号ごと。なければ u32::MAX）
    pub testimony: Vec<u32>,
    pub menu: Vec<u32>,
    pub nodes: usize,
    pub vars: Vec<Var>,
    /// 地点ごとの生きている変数（vars の番号。並びは vars の順）
    /// （同じ集まりは 1 つにまとめる: live_of が地点ごとの集まりの番号）
    live_sets: Vec<Vec<u32>>,
    live_of: Vec<u32>,
    /// 流れのグラフ（辺の先と、辺を通るときに必ず書き込まれる変数）と、地点ごとの読む・書く変数
    pub succ: Vec<Vec<Edge>>,
    pub gen: Vec<Vec<u32>>,
    pub def: Vec<Vec<u32>>,
    /// 地点ごとの生きている証拠品（ev_words 語ずつ。None ならすべての証拠品をキーに入れる）
    pub live_ev: Option<Vec<u64>>,
    /// 証拠品の前向きの解析（持っているかもしれない・必ず持っている証拠品、着きうる地点）
    pub ev: Option<evflow::EvResult>,
    pub ev_words: usize,
}

impl Flow {
    /// 状態が今いる地点
    pub fn node_of(&self, scene: u32, pc: u32, mode: Mode) -> u32 {
        match mode {
            Mode::Testimony => self.testimony[scene as usize],
            Mode::Investigate => self.menu[scene as usize],
            Mode::Run => self.base[scene as usize] + pc,
        }
    }
    pub fn live(&self, node: u32) -> &[u32] {
        &self.live_sets[self.live_of[node as usize] as usize]
    }

    /// 地点の生きている変数の集まりの番号と、集まりの一覧
    pub fn live_set_of(&self, node: u32) -> u32 {
        self.live_of[node as usize]
    }
    pub fn live_sets(&self) -> &[Vec<u32>] {
        &self.live_sets
    }

    /// 状態の地点と証拠品が、この解析の前提（持っているかもしれない・必ず持っている証拠品）に入っているか
    pub fn covers(&self, node: u32, held: &[u64]) -> bool {
        let Some(r) = &self.ev else { return false };
        let (w, v) = (self.ev_words, node as usize);
        r.reached[v] && (0..w).all(|i| held[i] & !r.may[v * w + i] == 0 && r.must[v * w + i] & !held[i] == 0)
    }

    /// 地点で生きている証拠品（None ならすべて）
    pub fn live_ev(&self, node: u32) -> Option<&[u64]> {
        let w = self.ev_words;
        self.live_ev.as_ref().map(|v| &v[node as usize * w..node as usize * w + w])
    }

    /// 地点の名前（シーン:pc・シーン:尋問・シーン:メニュー）
    pub fn node_name(&self, m: &Model, node: u32) -> String {
        for (i, sc) in m.scenes.iter().enumerate() {
            if self.testimony[i] == node { return format!("{}:尋問", sc.id); }
            if self.menu[i] == node { return format!("{}:メニュー", sc.id); }
            let b = self.base[i];
            if node >= b && node < b + sc.program.len() as u32 { return format!("{}:{}", sc.id, node - b); }
        }
        format!("?{node}")
    }

    /// 変数 v が地点 from で生きている理由（読む所までの道）。確かめ用
    pub fn explain(&self, v: u32, from: u32) -> Option<Vec<u32>> {
        let mut prev = vec![u32::MAX; self.nodes];
        let mut q = std::collections::VecDeque::from([from]);
        prev[from as usize] = from;
        while let Some(n) = q.pop_front() {
            if self.gen[n as usize].contains(&v) {
                let mut path = vec![n];
                let mut x = n;
                while x != from { x = prev[x as usize]; path.push(x); }
                path.reverse();
                return Some(path);
            }
            if n != from && self.def[n as usize].contains(&v) { continue; }
            for e in &self.succ[n as usize] {
                if e.kill == i64::from(v) || prev[e.to as usize] != u32::MAX { continue; }
                prev[e.to as usize] = n;
                q.push_back(e.to);
            }
        }
        None
    }
}

pub fn analyze(m: &Model, opts: FlowOptions) -> Flow {
    let g = build(m);
    let ev_words = m.evidence.len().div_ceil(64).max(1);
    let mut start = vec![0u64; ev_words];
    for &e in &m.start_evidence { start[e as usize >> 6] |= 1 << (e & 63); }
    let seeds = [(g.start, start)];
    analyze_from(m, g, opts, &seeds)
}

/// 組み立てたグラフ g を、seeds（地点と、そこで持っている証拠品）から調べる
pub fn analyze_from(m: &Model, mut g: Built, opts: FlowOptions, seeds: &[(u32, Vec<u64>)]) -> Flow {
    let ev_words = m.evidence.len().div_ceil(64).max(1);
    // 証拠品の流れ: 持てない証拠品を詳しく調べる辺を除き、生きている証拠品を求める（evflow.rs）
    let mut ev = opts.evidence.then(|| evflow::analyze(m, &mut g, ev_words, seeds));
    let live_ev = ev.as_mut().map(|r| std::mem::take(&mut r.live));
    let nodes = g.nodes;
    let words = g.vars.len().div_ceil(64).max(1);
    let bits = if opts.all { vec![u64::MAX; nodes * words] } else { solve(nodes, words, &g.gen, &g.def, &g.succ, true) };
    let mut live_sets: Vec<Vec<u32>> = vec![];
    let mut index: std::collections::HashMap<Vec<u32>, u32> = std::collections::HashMap::new();
    let live_of = (0..nodes).map(|v| {
        let set: Vec<u32> = (0..g.vars.len() as u32).filter(|&i| bits[v * words + (i as usize >> 6)] >> (i & 63) & 1 == 1).collect();
        *index.entry(set.clone()).or_insert_with(|| { live_sets.push(set); live_sets.len() as u32 - 1 })
    }).collect();
    Flow {
        base: g.base, testimony: g.testimony, menu: g.menu, nodes, vars: g.vars, live_sets, live_of, succ: g.succ, gen: g.gen, def: g.def,
        live_ev, ev, ev_words,
    }
}

/// 後ろ向きのデータフロー解析（生きている変数）。
/// in(n) = gen(n) ∪ (out(n) − def(n))、out(n) = ∪ (in(辺の先) − 辺の kill)。変わらなくなるまで繰り返す
/// kills: 辺の kill を使うか（証拠品の解析では使わない）
pub fn solve(n: usize, words: usize, gen: &[Vec<u32>], def: &[Vec<u32>], succ: &[Vec<Edge>], kills: bool) -> Vec<u64> {
    let mut live = vec![0u64; n * words];
    let mut preds: Vec<Vec<u32>> = vec![vec![]; n];
    for (from, es) in succ.iter().enumerate() { for e in es { preds[e.to as usize].push(from as u32); } }
    for v in 0..n { for &g in &gen[v] { live[v * words + (g as usize >> 6)] |= 1 << (g & 63); } }
    let mut tmp = vec![0u64; words];
    let mut queued = vec![true; n];
    let mut work: Vec<u32> = (0..n as u32).rev().collect();
    while let Some(v) = work.pop() {
        let v = v as usize;
        queued[v] = false;
        tmp.fill(0);
        for e in &succ[v] {
            for w in 0..words { tmp[w] |= live[e.to as usize * words + w]; }
            // 辺の kill は、辺の先で読む前に必ず書き込まれるので、前の値は読まれない
            if kills && e.kill >= 0 { tmp[e.kill as usize >> 6] &= !(1 << (e.kill & 63)); }
        }
        for &d in &def[v] { tmp[d as usize >> 6] &= !(1 << (d & 63)); }
        let mut changed = false;
        for w in 0..words {
            let nv = live[v * words + w] | tmp[w];
            if nv != live[v * words + w] { live[v * words + w] = nv; changed = true; }
        }
        if changed { for &p in &preds[v] { if !queued[p as usize] { queued[p as usize] = true; work.push(p); } } }
    }
    live
}
