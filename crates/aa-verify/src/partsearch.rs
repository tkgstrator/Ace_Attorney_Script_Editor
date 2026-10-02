// 編ごとに調べる網羅的な探索（TS 版にない工夫）。
//
// - 編（シナリオの parts）ごとに、その編に入った状態の集まりから探索する。別の編のシーンに入ったら、そこで止めて
//   「出口」とし、その状態を行き先の編の入り口に渡す（持ち越す証拠品・フラグがあっても、そのまま渡す）。
//   出口の状態は、出た編の解析でのキーで重複を除いてから渡す
// - 行き来のある編（探偵パートが 2 つの編に分かれているなど。流れのグラフで互いに行ける編）は 1 つのまとまりにする
// - 編ごとの流れの解析（flow.rs・evflow.rs）は、実際に編に入った状態から始める。始まりから一律に解析するより、
//   「この編ではもう持っていない証拠品」などが分かり、生きている変数が減る（例: 第 5 話で、前の編で使い切った
//   3D の証拠品を詳しく調べて、昔の編へ飛ぶ道が消え、昔の編の話題のフラグがキーから外れる）
// - 後から、解析の前提（入り口の地点で、持っているかもしれない・必ず持っている証拠品）に入らない状態が
//   入り口に来たら、その編の解析をやり直した
//   新しい版で、その状態から先を調べる（古い版で見つけた状態とは見分けたまま。重複はあっても、漏れはない）
// - 詰みは、編をまたぐ辺もつないだ全体のグラフで調べる（編ごとの報告は、場面のシーンの編で分ける）
use crate::actions::{actions, step_run, Act, ExamineHits, Prep, Stop, NO_PART};
use crate::engine::{BeatKind, Engine};
use crate::flow::{analyze_from, Flow, FlowOptions};
use crate::flowgraph::Built;
use crate::graph::Graph;
use crate::key::KeyMaker;
use crate::model::Model;
use crate::search::{or_into, rank, KeyMap, Search, SearchOptions, NO_PARENT};
use crate::state::{pack, unpack, Bits, State};
use std::collections::HashSet;

/// 編ごとの数字
#[derive(Clone, Debug, Default)]
pub struct PartStat {
    pub id: String,
    pub states: usize,
    /// 入り口に来た状態の数（重複を含む）と、解析をやり直した回数
    pub entries: usize,
    pub versions: usize,
    pub sec: f64,
}

/// 辺の行き先のうち、まだ番号の決まっていない入り口（最上位ビットを立てる）
const SLOT: u32 = 0x8000_0000;

type Seed = (u32, Vec<u64>);

struct Version {
    flow: Flow,
    keys: KeyMap,
    seeds: HashSet<Seed>,
    /// 出口の状態のキー（この版の解析での）→ 入り口の番号
    exits: KeyMap,
}

struct Entry {
    /// 調べ終えたら捨てる
    packed: Option<Box<[u8]>>,
    from: u32,
    act: u32,
    slot: u32,
}

#[derive(Default)]
struct Part {
    versions: Vec<Version>,
    entries: Vec<Entry>,
    done: usize,
}

pub struct PartSearch {
    pub search: Search,
    /// 状態ごとのまとまり
    pub group_of_id: Vec<u16>,
    /// シーンごとのまとまり（行き来のある編をまとめたもの）
    pub group_of: Vec<u16>,
    pub stats: Vec<PartStat>,
}

/// シーンごとの編の番号（編に入らないシーンは NO_PART）
pub fn part_table(m: &Model) -> Vec<u16> {
    let mut t = vec![NO_PART; m.scenes.len()];
    for (i, p) in m.parts.iter().enumerate() {
        for &s in &p.scenes {
            t[s as usize] = i as u16;
        }
    }
    t
}

fn ev_bits(m: &Model, s: &State) -> Vec<u64> {
    let mut v = vec![0u64; m.evidence.len().div_ceil(64).max(1)];
    for &e in &s.evidence {
        v[e as usize >> 6] |= 1 << (e & 63);
    }
    v
}

/// 流れのグラフで互いに行ける編をまとめる。まとまりの番号（シーンごと）と、まとまりを調べる順（行き先が後）を返す
fn groups(m: &Model, built: &Built, part_of: &[u16]) -> (Vec<u16>, Vec<Vec<usize>>) {
    let np = m.parts.len();
    // 地点ごとの編
    // ライフが尽きたときのシーン（続きから始める所へ飛ぶことが多い）は、編のつながりに数えない
    let mut node_part = vec![NO_PART; built.nodes];
    for (i, sc) in m.scenes.iter().enumerate() {
        let p = if m.gameover_scene == Some(i as u32) {
            NO_PART
        } else {
            part_of[i]
        };
        for pc in 0..sc.program.len() {
            node_part[built.base[i] as usize + pc] = p;
        }
        for t in [built.testimony[i], built.menu[i]] {
            if t != u32::MAX {
                node_part[t as usize] = p;
            }
        }
    }
    // 始まりから流れのグラフでたどれる地点（ライフが尽きたときのシーンなど、調べるときに着かない所の辺は数えない）
    let mut reached = vec![false; built.nodes];
    let mut work = vec![built.start];
    reached[built.start as usize] = true;
    while let Some(u) = work.pop() {
        for e in &built.succ[u as usize] {
            if !reached[e.to as usize] {
                reached[e.to as usize] = true;
                work.push(e.to);
            }
        }
    }
    // 編から編への辺（編に入らないシーンを通る辺は数えない）
    let mut adj = vec![vec![false; np]; np];
    for (u, es) in built.succ.iter().enumerate() {
        let a = node_part[u];
        if a == NO_PART || !reached[u] {
            continue;
        }
        for e in es {
            let b = node_part[e.to as usize];
            if b != NO_PART && b != a {
                adj[a as usize][b as usize] = true;
            }
        }
    }
    // 推移閉包で、互いに行ける編をまとめる（編の数は数十なので素朴に）
    let mut reach = adj.clone();
    for k in 0..np {
        for i in 0..np {
            if reach[i][k] {
                for j in 0..np {
                    if reach[k][j] {
                        reach[i][j] = true;
                    }
                }
            }
        }
    }
    let mut comp = vec![usize::MAX; np];
    let mut members: Vec<Vec<usize>> = vec![];
    for i in 0..np {
        if comp[i] != usize::MAX {
            continue;
        }
        let c = members.len();
        let mut list = vec![i];
        for j in i + 1..np {
            if reach[i][j] && reach[j][i] {
                list.push(j);
            }
        }
        for &j in &list {
            comp[j] = c;
        }
        members.push(list);
    }
    let table = part_of
        .iter()
        .map(|&p| {
            if p == NO_PART {
                NO_PART
            } else {
                comp[p as usize] as u16
            }
        })
        .collect();
    (table, members)
}

pub fn explore_parts(
    m: &Model,
    built: &Built,
    prep: &Prep,
    opts: &SearchOptions,
    fopts: FlowOptions,
) -> Result<PartSearch, String> {
    let part_of = part_table(m);
    let (group_of, members) = groups(m, built, &part_of);
    // 編の外（編の定義がない・始まりが編の外）は、最後の番号のまとまりとして扱う
    let outside = members.len();
    let n_groups = outside + 1;
    let group_index = |scene: u32| -> usize {
        match group_of.get(scene as usize).copied() {
            Some(g) if g != NO_PART => g as usize,
            _ => outside,
        }
    };
    let mut parts: Vec<Part> = (0..n_groups).map(|_| Part::default()).collect();
    let mut stats: Vec<PartStat> = (0..n_groups)
        .map(|i| PartStat {
            id: members.get(i).map_or_else(
                || "（編の外）".to_string(),
                |l| {
                    l.iter()
                        .map(|&p| m.parts[p].id.as_str())
                        .collect::<Vec<_>>()
                        .join("+")
                },
            ),
            ..PartStat::default()
        })
        .collect();
    let mut r = Search {
        states: 0,
        processed: 0,
        truncated: false,
        cleared: false,
        graph: Graph::default(),
        parent: vec![],
        via: vec![],
        ranks: vec![],
        goals: vec![],
        visited: Bits::new(m.visit_count()),
        moved: Bits::new(m.visit_count()),
        seen: Bits::new(m.seen_ids.len()),
        crashes: vec![],
        peak_pending: 0,
        peak_pending_bytes: 0,
        per_scene: vec![0; m.scenes.len()],
    };
    let mut pid: Vec<u16> = vec![];
    let mut slots: Vec<u32> = vec![];

    let first = Engine::new(m).map_err(|e| format!("始めの状態を作れません: {e}"))?;
    or_into(&mut r.visited, &first.s.visited);
    r.visited.add(first.s.scene);
    let p0 = group_index(first.s.scene);
    slots.push(u32::MAX);
    parts[p0].entries.push(Entry {
        packed: Some(pack(&first.s)),
        from: NO_PARENT,
        act: 0,
        slot: 0,
    });

    'rounds: loop {
        let mut any = false;
        for p in 0..n_groups {
            if parts[p].done == parts[p].entries.len() {
                continue;
            }
            any = true;
            let started = Clock::start();
            let cur_part = if p == outside { NO_PART } else { p as u16 };
            // 新しい入り口が、今の版の解析の前提に入っているか。入っていなければ、解析をやり直した版を作る
            let new_seeds: Vec<Seed> = parts[p].entries[parts[p].done..]
                .iter()
                .map(|en| {
                    let s = unpack(en.packed.as_ref().unwrap(), m);
                    (built_node(built, &s), ev_bits(m, &s))
                })
                .collect();
            let covered = parts[p]
                .versions
                .last()
                .is_some_and(|v| new_seeds.iter().all(|(n, ev)| v.flow.covers(*n, ev)));
            if !covered {
                let mut seeds: HashSet<Seed> = parts[p]
                    .versions
                    .last()
                    .map(|v| v.seeds.clone())
                    .unwrap_or_default();
                seeds.extend(new_seeds);
                let list: Vec<Seed> = seeds.iter().cloned().collect();
                let flow = analyze_from(m, built.clone(), fopts, &list);
                parts[p].versions.push(Version {
                    flow,
                    keys: KeyMap::default(),
                    seeds,
                    exits: KeyMap::default(),
                });
                stats[p].versions += 1;
            }
            let part = &mut parts[p];
            let ver = part.versions.last_mut().unwrap();
            let keys = KeyMaker::new(m, &ver.flow);
            let mut stack: Vec<(u32, Box<[u8]>)> = vec![];
            // 入り口の状態に番号を付ける
            for en in part.entries[part.done..].iter_mut() {
                let packed = en.packed.take().unwrap();
                let s = unpack(&packed, m);
                let k = keys.key(&s);
                let next = r.parent.len() as u32;
                let id = *ver.keys.entry(k).or_insert_with(|| {
                    stack.push((next, packed));
                    r.parent.push(en.from);
                    r.via.push(en.act);
                    pid.push(cur_part);
                    next
                });
                slots[en.slot as usize] = id;
            }
            stats[p].entries += part.entries.len() - part.done;
            part.done = part.entries.len();
            let stop = Stop::Part {
                part_of: &group_of,
                part: cur_part,
            };
            let mut exits: Vec<(usize, Entry)> = vec![];
            while let Some((i, bytes)) = stack.pop() {
                if r.processed >= opts.limit {
                    r.truncated = true;
                    break 'rounds;
                }
                if let Some(pr) = &opts.progress {
                    if r.processed % opts.progress_every == 0 {
                        pr(r.processed, r.parent.len());
                    }
                }
                r.processed += 1;
                stats[p].states += 1;
                let e = Engine::load(m, unpack(&bytes, m));
                drop(bytes);
                r.graph.open(i);
                if let Some(c) = r.per_scene.get_mut(e.s.scene as usize) {
                    *c += 1;
                }
                let b = match e.beat() {
                    Ok(b) => b,
                    Err(msg) => {
                        crash(&mut r, msg, e.s.scene);
                        continue;
                    }
                };
                set_at(&mut r.ranks, i, rank(b), 4);
                if matches!(b, BeatKind::End | BeatKind::Gameover) {
                    set_at(&mut r.goals, i, true, false);
                    if b == BeatKind::End {
                        r.cleared = true;
                    }
                    continue;
                }
                let acts = match actions(&e, prep, Some(&mut r.visited)) {
                    Ok(a) => a,
                    Err(msg) => {
                        crash(&mut r, msg, e.s.scene);
                        continue;
                    }
                };
                // 「調べる」は、当たる調べる所が同じなら結果も同じなので、1 回だけ実行する
                let mut examined: Vec<(Option<usize>, u32)> = vec![];
                let mut x = e.clone();
                let hits = ExamineHits::new(&e);
                for (a, act) in acts.iter().enumerate() {
                    if let Act::Move(p) = act {
                        r.moved.add(*p);
                    }
                    let hit = match (act, &hits) {
                        (Act::Examine(x, y), Some(h)) => h.hit(e.place().unwrap(), *x, *y).ok(),
                        _ => None,
                    };
                    if let Some(&(_, t)) = hit.and_then(|h| examined.iter().find(|(k, _)| *k == h))
                    {
                        r.graph.add(i, t);
                        continue;
                    }
                    x.s.copy_from(&e.s);
                    let run = |x: &mut Engine| match hit {
                        Some(h) => x.examine_known(h),
                        None => act.run(x),
                    };
                    if let Err(msg) = step_run(stop, &mut x, run, Some(&mut r.visited)) {
                        crash(&mut r, msg, e.s.scene);
                        continue;
                    }
                    or_into(&mut r.visited, &x.s.visited);
                    or_into(&mut r.seen, &x.s.seen);
                    if (x.s.scene as usize) < m.scenes.len() {
                        r.visited.add(x.s.scene);
                    }
                    // 別の編に入った: 行き先の編の入り口に渡す（番号は、行き先の編を調べるときに決まる）。
                    // この編の解析でのキーが同じ出口は、この先の動きが同じなので 1 つだけ渡す
                    let q = group_of.get(x.s.scene as usize).copied().unwrap_or(NO_PART);
                    let k = keys.key(&x.s);
                    if q != NO_PART && q != cur_part {
                        let slot = slots.len() as u32;
                        let got = *ver.exits.entry(k).or_insert_with(|| {
                            slots.push(u32::MAX);
                            exits.push((
                                q as usize,
                                Entry {
                                    packed: Some(pack(&x.s)),
                                    from: i,
                                    act: a as u32,
                                    slot,
                                },
                            ));
                            slot
                        });
                        r.graph.add(i, SLOT | got);
                        if let Some(h) = hit {
                            examined.push((h, SLOT | got));
                        }
                        continue;
                    }
                    let next = r.parent.len() as u32;
                    let id = *ver.keys.entry(k).or_insert_with(|| {
                        stack.push((next, pack(&x.s)));
                        r.parent.push(i);
                        r.via.push(a as u32);
                        pid.push(cur_part);
                        next
                    });
                    r.graph.add(i, id);
                    if let Some(h) = hit {
                        examined.push((h, id));
                    }
                }
                r.peak_pending = r.peak_pending.max(stack.len());
            }
            for (q, en) in exits {
                parts[q].entries.push(en);
            }
            // 調べる順: 行き先のまとまりが後になるよう、番号の小さいまとまりから（戻る辺があれば、次の周で調べる）
            stats[p].sec += started.sec();
        }
        if !any {
            break;
        }
    }

    // 編をまたぐ辺の行き先を、入り口の状態の番号に置き換える
    let n = r.parent.len();
    for t in r.graph.targets.iter_mut() {
        if *t & SLOT != 0 {
            let id = slots[(*t & !SLOT) as usize];
            *t = if id == u32::MAX { u32::MAX } else { id };
        }
    }
    if r.truncated {
        // 打ち切ったときは、行き先の決まっていない辺が残る（詰みは調べない）
        r.graph.targets.iter_mut().for_each(|t| {
            if *t == u32::MAX {
                *t = 0
            }
        });
    }
    r.states = if r.truncated { r.processed } else { n };
    r.ranks.resize(n, 4);
    r.goals.resize(n, false);
    let stats = stats
        .into_iter()
        .filter(|s| s.states > 0 || s.entries > 0)
        .collect();
    Ok(PartSearch {
        search: r,
        group_of_id: pid,
        group_of,
        stats,
    })
}

/// 状態が今いる地点（どの版の解析でも、地点の番号は同じ）
fn built_node(b: &Built, s: &State) -> u32 {
    use crate::state::Mode;
    match s.mode {
        Mode::Testimony => b.testimony[s.scene as usize],
        Mode::Investigate => b.menu[s.scene as usize],
        Mode::Run => b.base[s.scene as usize] + s.pc,
    }
}

fn crash(r: &mut Search, msg: String, scene: u32) {
    let msg = format!("実行中にエラーになりました: {msg}");
    if !r.crashes.iter().any(|(m, _)| *m == msg) {
        r.crashes.push((msg, scene));
    }
}

fn set_at<T: Copy>(v: &mut Vec<T>, i: u32, x: T, fill: T) {
    if v.len() <= i as usize {
        v.resize(i as usize + 1, fill);
    }
    v[i as usize] = x;
}

/// 時間を計る（WebAssembly では時計がないので 0 にする）
struct Clock(#[cfg(not(target_arch = "wasm32"))] std::time::Instant);

impl Clock {
    fn start() -> Clock {
        #[cfg(not(target_arch = "wasm32"))]
        return Clock(std::time::Instant::now());
        #[cfg(target_arch = "wasm32")]
        return Clock();
    }
    fn sec(&self) -> f64 {
        #[cfg(not(target_arch = "wasm32"))]
        return self.0.elapsed().as_secs_f64();
        #[cfg(target_arch = "wasm32")]
        return 0.0;
    }
}
