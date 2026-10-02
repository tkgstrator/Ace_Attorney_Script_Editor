// 証拠品の流れ（TS 版にない工夫）。流れのグラフの上で、
// 1. 各地点で「持っているかもしれない証拠品」（前向き・和）を求め、持てない証拠品を詳しく調べる辺を除く。
//    例: 詳しく調べると取り上げられる証拠品（第 5 話の 3D の証拠品など）は、取り上げた後の編では調べられないので、
//    調べるシーンから昔の編のシーンへ飛ぶ道を、後の編の流れから外せる（昔の編のフラグが生き残らない）
// 2. 各地点で「必ず持っている証拠品」（前向き・積）を求める。見当違いのつきつけができるかは、正解でない証拠品を
//    持っているかで決まるが、正解でない証拠品を必ず持っていれば、ほかの証拠品を持っているかは効かない
// 3. 各地点で「この先で持っているかを読むかもしれない証拠品」（後ろ向き）を求める。キーには、これだけを入れる
// どれも流れのグラフの上の、値によらない解析なので、近似ではなく、この先の動きが同じ状態だけをまとめる。
use crate::flow::solve;
use crate::flowgraph::{Built, NO_EV};
use crate::model::Model;

fn has(v: &[u64], i: u32) -> bool {
    v[i as usize >> 6] >> (i & 63) & 1 == 1
}

/// 地点での証拠品の変化を当てはめる。may: 持っているかもしれない証拠品の解析か（そうでなければ、必ず持っている証拠品）。
/// まとめた if のかたまりの中の出し入れは、通るかもしれないだけなので、may なら足すだけ、must なら除くだけ
fn transfer(g: &Built, node: usize, v: &mut [u64], may: bool) {
    if let Some((x, give)) = g.ev_effect[node] {
        if give {
            v[x as usize >> 6] |= 1 << (x & 63)
        } else {
            v[x as usize >> 6] &= !(1 << (x & 63))
        }
    }
    for &(x, give) in &g.ev_maybe[node] {
        if give && may {
            v[x as usize >> 6] |= 1 << (x & 63)
        }
        if !give && !may {
            v[x as usize >> 6] &= !(1 << (x & 63))
        }
    }
}

/// 証拠品の解析の結果（地点ごとに words 語）
pub struct EvResult {
    /// 生きている証拠品
    pub live: Vec<u64>,
    /// 持っているかもしれない・必ず持っている証拠品と、着きうる地点
    pub may: Vec<u64>,
    pub must: Vec<u64>,
    pub reached: Vec<bool>,
}

/// 証拠品の流れを解析する。g の、持てない証拠品を詳しく調べる辺は除く。
/// seeds は、調べ始める地点と、そこで持っている証拠品（編ごとに調べるときは、編に入った状態の集まり）
pub fn analyze(m: &Model, g: &mut Built, words: usize, seeds: &[(u32, Vec<u64>)]) -> EvResult {
    let n = g.nodes;
    // 詳しく調べるシーンごとの、ブロックの終わりの地点
    let mut ends: Vec<Vec<u32>> = vec![vec![]; m.scenes.len()];
    for &(node, scene) in &g.inspect_end {
        ends[scene as usize].push(node);
    }
    let scene_of_ev = |ev: u32| {
        m.evidence[ev as usize]
            .inspect
            .filter(|&s| (s as usize) < m.scenes.len())
    };

    // 1. 持っているかもしれない証拠品（詳しく調べる辺は、その証拠品を持っているかもしれないときだけ通れる。
    //    調べ終えたら、調べ始めた地点に戻る）
    let mut may = vec![0u64; n * words];
    let mut reached = vec![false; n];
    let mut origins: Vec<Vec<u32>> = vec![vec![]; m.scenes.len()];
    let mut work = vec![];
    for (node, held) in seeds {
        let v = *node as usize;
        for w in 0..words {
            may[v * words + w] |= held[w];
        }
        reached[v] = true;
        work.push(*node);
    }
    let mut out = vec![0u64; words];
    while let Some(v) = work.pop() {
        let v = v as usize;
        out.copy_from_slice(&may[v * words..v * words + words]);
        let held_in = out.clone();
        transfer(g, v, &mut out, true);
        let mut targets: Vec<u32> = vec![];
        for e in &g.succ[v] {
            if e.ev != NO_EV {
                if !has(&held_in, e.ev) {
                    continue;
                }
                if let Some(s) = scene_of_ev(e.ev) {
                    if !origins[s as usize].contains(&(v as u32)) {
                        origins[s as usize].push(v as u32);
                        // 新しい戻り先: 終わりの地点から、ここへ流し直す
                        work.extend(
                            ends[s as usize]
                                .iter()
                                .copied()
                                .filter(|&x| reached[x as usize]),
                        );
                    }
                }
            }
            targets.push(e.to);
        }
        if let Some(&(_, s)) = g.inspect_end.iter().find(|(x, _)| *x as usize == v) {
            targets.extend(&origins[s as usize]);
        }
        for t in targets {
            let t = t as usize;
            let mut changed = !reached[t];
            reached[t] = true;
            for w in 0..words {
                let nv = may[t * words + w] | out[w];
                if nv != may[t * words + w] {
                    may[t * words + w] = nv;
                    changed = true;
                }
            }
            if changed {
                work.push(t as u32);
            }
        }
    }
    // 持てない証拠品を詳しく調べる辺を除く
    for v in 0..n {
        let held = may[v * words..v * words + words].to_vec();
        g.succ[v].retain(|e| e.ev == NO_EV || (reached[v] && has(&held, e.ev)));
    }

    // 2. 必ず持っている証拠品（着いたことのない地点は「すべて」のまま）
    let mut must = vec![u64::MAX; n * words];
    let mut seen = vec![false; n];
    let mut work = vec![];
    for (node, held) in seeds {
        let v = *node as usize;
        for w in 0..words {
            must[v * words + w] &= held[w];
        }
        seen[v] = true;
        work.push(*node);
    }
    while let Some(v) = work.pop() {
        let v = v as usize;
        out.copy_from_slice(&must[v * words..v * words + words]);
        transfer(g, v, &mut out, false);
        let mut targets: Vec<u32> = g.succ[v].iter().map(|e| e.to).collect();
        if let Some(&(_, s)) = g.inspect_end.iter().find(|(x, _)| *x as usize == v) {
            targets.extend(&origins[s as usize]);
        }
        for t in targets {
            let t = t as usize;
            let mut changed = !seen[t];
            seen[t] = true;
            for w in 0..words {
                let nv = must[t * words + w] & out[w];
                if nv != must[t * words + w] {
                    must[t * words + w] = nv;
                    changed = true;
                }
            }
            if changed {
                work.push(t as u32);
            }
        }
    }

    // 見当違いのつきつけができるかを読む地点: 正解でない証拠品（人物ファイルもつきつけられるなら、人物ファイルも）を
    // 必ず持っているとは言えなければ、すべての証拠品・人物ファイルを読む
    let all: Vec<u32> = (0..m.evidence.len() as u32).collect();
    let evidence_only: Vec<u32> = all.iter().copied().filter(|&x| !m.is_profile(x)).collect();
    for (node, lists, profiles) in &g.present_points {
        let v = *node as usize;
        if !reached[v] {
            continue;
        }
        let held = &must[v * words..v * words + words];
        let usable = |b: u32| *profiles || !m.is_profile(b);
        let sure = |answers: &Vec<u32>| {
            (0..m.evidence.len() as u32).any(|b| usable(b) && has(held, b) && !answers.contains(&b))
        };
        if !lists.iter().all(sure) {
            g.ev_gen[v].extend(if *profiles { &all } else { &evidence_only });
        }
    }

    // 3. 生きている証拠品（後ろ向き）
    let live = solve(n, words, &g.ev_gen, &g.ev_def, &g.succ, false);
    EvResult {
        live,
        may,
        must,
        reached,
    }
}
