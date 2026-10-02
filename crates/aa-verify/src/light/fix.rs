// 軽いチェックの前向きの解析: 始まりから、通れる辺（条件が真になりうる・証拠品を持ちうる・相手がいうる）だけを
// たどって着きうる地点を求め、同時に、フラグの取りうる値・着きうるシーン・付きうる調べた印・地点ごとの証拠品を集める。
// フラグの値が増えると通れる辺も増えるので、変わらなくなるまで繰り返す。
use super::abs::{eval, Facts, Vals};
use super::graph::{Effect, LEdge, LGraph, Site};
use crate::model::*;
use crate::state::Bits;

pub struct Fix {
    pub reached: Vec<bool>,
    pub words: usize,
    pub may: Vec<u64>,
    pub must: Vec<u64>,
    pub flags: Vec<Vals>,
    /// 着きうるシーン・付きうる調べた印
    pub visited: Bits,
    pub seen: Bits,
    /// 詳しく調べるシーンごとの、調べ始めうる地点
    pub origins: Vec<Vec<u32>>,
}

impl Fix {
    pub fn facts(&self, node: u32) -> Facts<'_> {
        let (w, v) = (self.words, node as usize);
        Facts {
            flags: &self.flags,
            visited: &self.visited,
            seen: &self.seen,
            may: &self.may[v * w..v * w + w],
            must: &self.must[v * w..v * w + w],
        }
    }

    pub fn may_hold(&self, node: u32, x: u32) -> bool {
        self.may[node as usize * self.words + (x as usize >> 6)] >> (x & 63) & 1 == 1
    }

    /// 場所に相手（人物）がいうるか
    pub fn person(&self, m: &Model, g: &LGraph, place: u32) -> bool {
        let Some(p) = m.scenes[place as usize].place() else {
            return false;
        };
        let f = self.facts(g.menu[place as usize]);
        p.person
            .iter()
            .any(|w| w.as_ref().is_none_or(|w| eval(w, &f, m).truth().0))
    }

    /// 辺の条件だけが真（IfElse では偽）になりうるか
    pub fn cond_ok(&self, m: &Model, node: u32, e: &LEdge) -> bool {
        let Some(c) = e.cond else { return true };
        let (t, f) = eval(c, &self.facts(node), m).truth();
        if e.site == Site::IfElse {
            f
        } else {
            t
        }
    }

    /// 辺を通れうるか
    pub fn edge_ok(&self, m: &Model, g: &LGraph, node: u32, e: &LEdge) -> bool {
        if e.ev.is_some_and(|x| !self.may_hold(node, x)) {
            return false;
        }
        if e.person.is_some_and(|p| !self.person(m, g, p)) {
            return false;
        }
        self.cond_ok(m, node, e)
    }
}

pub fn run(m: &Model, g: &LGraph) -> Fix {
    let n = g.nodes;
    let words = m.evidence.len().div_ceil(64).max(1);
    let mut fx = Fix {
        reached: vec![false; n],
        words,
        may: vec![0; n * words],
        must: vec![u64::MAX; n * words],
        flags: m
            .flag_init
            .iter()
            .map(|v| Vals {
                list: vec![*v],
                any_num: false,
            })
            .collect(),
        visited: Bits::new(m.visit_count()),
        seen: Bits::new(m.seen_ids.len()),
        origins: vec![vec![]; m.scenes.len()],
    };
    let s = g.start as usize;
    for w in 0..words {
        fx.must[s * words + w] = 0;
    }
    for &x in &m.start_evidence {
        fx.may[s * words + (x as usize >> 6)] |= 1 << (x & 63);
        fx.must[s * words + (x as usize >> 6)] |= 1 << (x & 63);
    }
    fx.reached[s] = true;
    let mut work = vec![g.start];
    let (mut may, mut must) = (vec![0u64; words], vec![0u64; words]);
    loop {
        // 手がかり（フラグの値・シーン・調べた印）が増えたら、着いた地点をすべて見直す
        let mut grew = false;
        while let Some(v) = work.pop() {
            let vi = v as usize;
            may.copy_from_slice(&fx.may[vi * words..vi * words + words]);
            must.copy_from_slice(&fx.must[vi * words..vi * words + words]);
            match g.effect[vi] {
                Effect::Set(f, val) => grew |= fx.flags[f as usize].add(val),
                Effect::Add(f) => {
                    if !fx.flags[f as usize].any_num {
                        fx.flags[f as usize].any_num = true;
                        grew = true;
                    }
                }
                Effect::Give(x) => {
                    may[x as usize >> 6] |= 1 << (x & 63);
                    must[x as usize >> 6] |= 1 << (x & 63);
                }
                Effect::Take(x) => {
                    may[x as usize >> 6] &= !(1 << (x & 63));
                    must[x as usize >> 6] &= !(1 << (x & 63));
                }
                Effect::None => {}
            }
            let sc = g.scene_of[vi];
            if g.arrive(m, sc) == Some(v) {
                grew |= fx.visited.add(sc);
            }
            let mut targets: Vec<u32> = vec![];
            for e in &g.succ[vi] {
                if !fx.edge_ok(m, g, v, e) {
                    continue;
                }
                if let Some(x) = e.seen {
                    grew |= fx.seen.add(x);
                }
                if e.site == Site::Inspect {
                    let isc = m.evidence[e.ev.unwrap() as usize].inspect.unwrap() as usize;
                    if !fx.origins[isc].contains(&v) {
                        fx.origins[isc].push(v);
                        work.extend(
                            g.inspect_end[isc]
                                .iter()
                                .copied()
                                .filter(|&x| fx.reached[x as usize]),
                        );
                    }
                }
                targets.push(e.to);
            }
            // 詳しく調べ終えたら、調べ始めた地点へ戻る
            if let Some(origins) = fx.origins.get(sc as usize) {
                if g.inspect_end[sc as usize].contains(&v) {
                    targets.extend(origins);
                }
            }
            for t in targets {
                let ti = t as usize;
                let first = !fx.reached[ti];
                let mut changed = first;
                fx.reached[ti] = true;
                for w in 0..words {
                    let a = fx.may[ti * words + w] | may[w];
                    let b = if first {
                        must[w]
                    } else {
                        fx.must[ti * words + w] & must[w]
                    };
                    if a != fx.may[ti * words + w] || b != fx.must[ti * words + w] {
                        changed = true;
                    }
                    fx.may[ti * words + w] = a;
                    fx.must[ti * words + w] = b;
                }
                if changed {
                    work.push(t);
                }
            }
        }
        if !grew {
            break;
        }
        work = (0..n as u32).filter(|&v| fx.reached[v as usize]).collect();
    }
    fx
}
