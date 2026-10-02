// 文章送りだけの場面（台詞・日時の表示・証言を聞く途中）で「詳しく調べる」のを試すかを決める
// （verify-inspect-sim.ts と同じ判定）。状態を変えうる証拠品を持っていて法廷記録を開ける台詞でも、調べる場所ごとに、
// 次のどちらかなら、そこで試さなくてよい（どの場所もそうなら、止まらずに進める）。
// 1. 後に回せる: その場所で読み書きする変数と、この台詞から次に調べられる所までの命令で読み書きする変数が重ならない
//    （別のシーンへ移りうる場所は、試して元の場面に戻ったとき。試して別のシーンへ移ったときは、その場所が読む変数を
//    間の命令が書かず、間の命令が書く変数が移る先で死んでいるとき）
// 2. 調べても状態が変わらない。実際に試して確かめ、結果は読み書きする変数の値ごとに覚える
use crate::actions::CHAIN_LIMIT;
use crate::engine::{Engine, Res};
use crate::expr::test;
use crate::flow::Var;
use crate::inspect::{linear_static, LooseEnv};
use crate::key::Hasher128;
use crate::model::*;
use crate::region::{refs, Name};
use crate::state::State;
use std::cell::RefCell;
use std::collections::HashMap;

/// 読み書きする名前（証拠品・人物ファイルは Has、探偵メニューに着いた印は Visit）。r・w は、DeferInfo の names の
/// 番号のビットにしたもの（重なりを速く調べるため。names に無い名前は、どの調べる場所とも重ならないので入れない）
#[derive(Clone, Debug, Default)]
pub struct Access {
    pub reads: Vec<Name>,
    pub writes: Vec<Name>,
    r: Vec<u64>,
    w: Vec<u64>,
}

impl Access {
    fn finish(&mut self, names: &[Name]) {
        let bits = |list: &[Name]| {
            let mut v = vec![0u64; names.len().div_ceil(64).max(1)];
            for n in list {
                if let Some(i) = names.iter().position(|x| x == n) {
                    v[i >> 6] |= 1 << (i & 63);
                }
            }
            v
        };
        self.r = bits(&self.reads);
        self.w = bits(&self.writes);
    }
}

/// 調べる場所の読み書き。leaves: 元の場面に戻らないことがある。targets: Goto・Investigate で移りうる先。
/// hard: ほかの形で戻らないことがある（選ぶ場面・終わりなど）。target_live: 移りうる先のどれかで生きている変数
#[derive(Clone, Debug, Default)]
pub struct OptionSig {
    pub access: Access,
    pub leaves: bool,
    pub targets: Vec<u32>,
    pub hard: bool,
    pub target_live: Vec<Name>,
}

/// Model に置く下ごしらえ: 状態を変えうる証拠品ごとの、選択肢の項目の読み書きと、結果の覚え
#[derive(Clone, Debug, Default)]
pub struct DeferInfo {
    pub sigs: HashMap<u32, Vec<OptionSig>>,
    /// 結果を覚える見分けに使う名前（どれかの場所で読み書きする名前すべてと、証拠品ごとの名前）
    pub names: Vec<Name>,
    pub names_of: HashMap<u32, Vec<Name>>,
    /// 結果の覚え（状態が変わるか, 元の場面に戻るか, 別のシーンへ移ったか）と、skippable の結果の覚え
    pub cache: RefCell<crate::search::KeyMap<(bool, bool, bool)>>,
    pub skip_cache: RefCell<crate::search::KeyMap<bool>>,
}

/// 法廷記録の鍵（State の record_locked）を表す名前
const RECORD: Name = Name::Flag(u32::MAX);

fn add(list: &mut Vec<Name>, n: Name) {
    if n != Name::Life && !list.contains(&n) {
        list.push(n);
    }
}

/// 状態を読み書きする命令の読み書きを acc に足す。当てはまらなければ false
fn access(op: &Op, acc: &mut Access) -> bool {
    match op {
        Op::Set(f, _) | Op::Add(f, _) => add(&mut acc.writes, Name::Flag(*f)),
        Op::Give(x) | Op::Take(x) => {
            add(&mut acc.reads, Name::Has(*x));
            add(&mut acc.writes, Name::Has(*x));
        }
        Op::JumpUnless(c, _) => {
            let mut v = vec![];
            refs(c, &mut v);
            v.into_iter().for_each(|n| add(&mut acc.reads, n));
        }
        _ => return false,
    }
    true
}

/// 状態を何も読み書きしない命令か
fn quiet(op: &Op) -> bool {
    matches!(op, Op::Nop(_) | Op::Stop(_) | Op::Penalty(_))
}

/// pc から命令の流れをたどる（Jump・JumpUnless の両方の先）。visit が false を返したら、その先はたどらない
fn walk(program: &[Op], pc: u32, mut visit: impl FnMut(Option<&Op>, u32) -> bool) {
    let mut done = std::collections::HashSet::new();
    let mut todo = vec![pc];
    while let Some(at) = todo.pop() {
        if !done.insert(at) {
            continue;
        }
        let op = program.get(at as usize);
        if !visit(op, at) {
            continue;
        }
        match op {
            Some(Op::Jump(to)) => todo.push(*to),
            Some(Op::JumpUnless(_, to)) => {
                todo.push(at + 1);
                todo.push(*to);
            }
            Some(_) => todo.push(at + 1),
            None => {}
        }
    }
}

/// 台詞・日時の表示 pc から、次に調べられる所（次の台詞・日時の表示・選択肢・つきつけの要求・探偵メニュー）までの
/// 命令の読み書き。同じシーンの中だけを見る。ほかのシーンへ移る・法廷記録の鍵を変えるなどの命令を通りうるなら None
fn segment(program: &[Op], scene: u32, pc: u32) -> Option<Access> {
    let mut acc = Access::default();
    let mut ok = true;
    walk(program, pc + 1, |op, _| {
        if !ok {
            return false;
        }
        let Some(op) = op else {
            ok = false;
            return false;
        };
        match op {
            Op::Stop(StopKind::Line | StopKind::Card) | Op::Choice(_) | Op::Demand { .. } => false,
            Op::Menu => {
                add(&mut acc.writes, Name::Visit(scene));
                false
            }
            Op::Jump(_) => true,
            op if quiet(op) || access(op, &mut acc) => true,
            _ => {
                ok = false;
                false
            }
        }
    });
    ok.then_some(acc)
}

/// 下ごしらえ（状態を変えうる証拠品の選択肢の項目ごとの読み書きと、シーンごとの segment）
pub fn prepare(m: &mut Model) {
    let mut info = DeferInfo::default();
    for &x in &m.inspect_effective {
        let program = &m.scenes[m.evidence[x as usize].inspect.unwrap() as usize].program;
        let Some(Op::Choice(opts)) = program.first() else {
            continue;
        };
        let sigs: Vec<OptionSig> = opts
            .iter()
            .map(|o| {
                let mut g = OptionSig::default();
                add(&mut g.access.reads, Name::Has(x));
                if let Some(w) = &o.when {
                    let mut v = vec![];
                    refs(w, &mut v);
                    v.into_iter().for_each(|n| add(&mut g.access.reads, n));
                }
                walk(program, o.to, |op, _| match op {
                    Some(Op::InspectEnd) => false,
                    Some(Op::Jump(_)) => true,
                    Some(op) if quiet(op) || access(op, &mut g.access) => true,
                    Some(Op::Goto(t) | Op::Investigate(t)) => {
                        g.leaves = true;
                        g.targets.push(*t);
                        false
                    }
                    // 法廷記録の鍵は、どの間の命令も書かない名前として扱う（間の命令に鍵を変えるものがあれば、後に回さない）
                    Some(Op::Lock(_)) => {
                        add(&mut g.access.writes, RECORD);
                        true
                    }
                    _ => {
                        g.leaves = true;
                        g.hard = true;
                        false
                    }
                });
                g
            })
            .collect();
        let mut own = vec![];
        for g in &sigs {
            for n in g.access.reads.iter().chain(&g.access.writes) {
                add(&mut info.names, *n);
                add(&mut own, *n);
            }
        }
        info.names_of.insert(x, own);
        info.sigs.insert(x, sigs);
    }
    for sigs in info.sigs.values_mut() {
        for g in sigs {
            g.access.finish(&info.names);
        }
    }
    // 移りうる先で生きている変数（流れの解析は、TS 版と同じく証拠品の流れを使わないもの）
    if info.sigs.values().flatten().any(|g| !g.targets.is_empty()) {
        let flow = crate::flow::analyze(
            m,
            crate::flow::FlowOptions {
                all: false,
                evidence: false,
            },
        );
        for g in info.sigs.values_mut().flatten() {
            for &t in &g.targets {
                let Some(node) = entry_node(m, &flow, t) else {
                    g.hard = true;
                    continue;
                };
                for &v in flow.live(node) {
                    let n = match flow.vars[v as usize] {
                        Var::Flag(f) => Name::Flag(f),
                        Var::Visit(x) => Name::Visit(x),
                        Var::Seen(x) => Name::Seen(x),
                    };
                    add(&mut g.target_live, n);
                }
            }
        }
    }
    // 状態を変えうる証拠品ごとに、どの場所も（表示されるかによらず）segment の後に回せるか（ビットは inspect_effective の並び）
    let skips: Vec<(usize, Vec<bool>)> = m
        .inspect_effective
        .iter()
        .enumerate()
        .map(|(j, &x)| {
            (
                j,
                m.inspect_skip[m.evidence[x as usize].inspect.unwrap() as usize].clone(),
            )
        })
        .collect();
    for (si, sc) in m.scenes.iter_mut().enumerate() {
        sc.segment = (0..sc.program.len() as u32)
            .map(|pc| match sc.program[pc as usize] {
                Op::Stop(StopKind::Line | StopKind::Card) if !info.sigs.is_empty() => {
                    segment(&sc.program, si as u32, pc).map(|mut a| {
                        a.finish(&info.names);
                        a
                    })
                }
                _ => None,
            })
            .collect();
        sc.trivial =
            sc.segment
                .iter()
                .map(|seg| {
                    let mut bits = 0u64;
                    for (j, skip) in &skips {
                        let Some(sigs) = info.sigs.get(&m.inspect_effective[*j]) else {
                            continue;
                        };
                        if *j < 64
                            && sigs.iter().enumerate().all(|(i, g)| {
                                skip[i] || (!g.leaves && independent(g, seg.as_ref()))
                            })
                        {
                            bits |= 1 << j;
                        }
                    }
                    bits
                })
                .collect();
    }
    m.defer = info;
}

/// シーン・場所 id に入ったときの地点（場所なら、来たときのブロックか探偵メニュー）
fn entry_node(m: &Model, flow: &crate::flow::Flow, id: u32) -> Option<u32> {
    let sc = m.scenes.get(id as usize)?;
    Some(match &sc.kind {
        Kind::Testimony(_) => flow.testimony[id as usize],
        Kind::Place(p) => p
            .enter
            .map_or(flow.menu[id as usize], |pc| flow.base[id as usize] + pc),
        Kind::Dialogue => flow.base[id as usize],
    })
}

/// 別のシーンへ移った場所 g を、seg の後に回せるか（verify-inspect-sim.ts の deadAfterLeaving）
fn dead_after_leaving(g: &OptionSig, seg: Option<&Access>) -> bool {
    let Some(seg) = seg else { return false };
    if g.hard || !disjoint(&g.access.r, &seg.w) {
        return false;
    }
    seg.writes
        .iter()
        .all(|w| !matches!(w, Name::Has(_)) && !g.target_live.contains(w))
}

fn disjoint(a: &[u64], b: &[u64]) -> bool {
    a.iter().zip(b).all(|(x, y)| x & y == 0)
}

/// 調べる場所 g と seg の読み書きが重ならないか（重ならなければ、元の場面に戻るかぎり、seg の後に回せる）
fn independent(g: &OptionSig, seg: Option<&Access>) -> bool {
    let Some(seg) = seg else { return false };
    disjoint(&g.access.w, &seg.w) && disjoint(&g.access.w, &seg.r) && disjoint(&g.access.r, &seg.w)
}

/// inspect_stop の場面で、詳しく調べるのを試さずに進めてよいか（試すべき調べ方が 1 つもない）。
/// 結果は、今の場面と、持っている状態を変えうる証拠品と、その調べる場所で読み書きする名前の値だけで決まるので、
/// その組ごとに覚える
pub fn skippable(e: &Engine) -> bool {
    let m = e.m;
    let s = &e.s;
    // どの場所も後に回せる証拠品しか持っていなければ、試さずに進めてよい
    if s.mode == crate::state::Mode::Run {
        let trivial = m.scenes[s.scene as usize].trivial[s.pc as usize];
        if s.evidence.iter().all(|&x| {
            m.evidence[x as usize]
                .effective_index
                .is_none_or(|j| j < 64 && trivial >> j & 1 == 1)
        }) {
            return true;
        }
    }
    let mut small = [0u64; 4];
    let mut big = vec![];
    let words = m.evidence.len().div_ceil(64).max(1);
    let held: &mut [u64] = if words <= 4 {
        &mut small[..words]
    } else {
        big.resize(words, 0);
        &mut big
    };
    for &x in &s.evidence {
        held[x as usize >> 6] |= 1 << (x & 63);
    }
    let mut h = Hasher128::new();
    for v in [
        u64::from(s.scene),
        u64::from(s.pc),
        s.mode as u64,
        s.phase as u64,
        u64::from(s.statement),
    ] {
        h.write(v);
    }
    for &x in &s.evidence {
        if !m.evidence[x as usize].effective {
            continue;
        }
        h.write(u64::from(x));
        for n in &m.defer.names_of[&x] {
            let [a, b] = value(s, held, *n);
            h.write(a);
            h.write(b);
        }
    }
    let key = h.finish();
    if let Some(&hit) = m.defer.skip_cache.borrow().get(&key) {
        return hit;
    }
    let values: Vec<u64> = m
        .defer
        .names
        .iter()
        .flat_map(|n| value(s, held, *n))
        .collect();
    let out = skippable_now(e, held, &values);
    m.defer.skip_cache.borrow_mut().insert(key, out);
    out
}

/// 名前の値（2 語）
fn value(s: &State, held: &[u64], n: Name) -> [u64; 2] {
    match n {
        RECORD => [8, u64::from(s.record_locked)],
        Name::Flag(f) => match s.flags[f as usize] {
            FVal::Undef => [0, 0],
            FVal::Bool(b) => [1, u64::from(b)],
            FVal::Num(v) => [2, v.to_bits()],
            FVal::Str(v) => [3, u64::from(v)],
        },
        Name::Has(v) => [4, held[v as usize >> 6] >> (v & 63) & 1],
        Name::Visit(v) => [5, u64::from(s.visited.has(v))],
        Name::Seen(v) => [6, u64::from(s.seen.has(v))],
        Name::Life => [7, 0],
    }
}

fn skippable_now(e: &Engine, held: &[u64], values: &[u64]) -> bool {
    let m = e.m;
    let s = &e.s;
    let seg = if s.mode == crate::state::Mode::Run {
        m.scenes[s.scene as usize].segment[s.pc as usize].as_ref()
    } else {
        None
    };
    for &x in &m.inspect_effective {
        if held[x as usize >> 6] >> (x & 63) & 1 == 0 {
            continue;
        }
        let scene = m.evidence[x as usize].inspect.unwrap();
        let Some(Op::Choice(opts)) = m.scenes[scene as usize].program.first() else {
            return false;
        };
        let sigs = &m.defer.sigs[&x];
        let skip = &m.inspect_skip[scene as usize];
        let mut shown = 0;
        for (i, o) in opts.iter().enumerate() {
            if !test(o.when.as_ref(), &LooseEnv(s), m).unwrap_or(false) {
                continue;
            }
            let n = shown;
            shown += 1;
            let free = independent(&sigs[i], seg);
            if skip[i] || (free && !sigs[i].leaves) {
                continue;
            }
            let (changed, returned, left) = changes(e, x, i, n, values);
            if (free && returned) || !changed || (left && dead_after_leaving(&sigs[i], seg)) {
                continue;
            }
            return false;
        }
    }
    true
}

/// 証拠品 x の i 番目（表示の番号 n）の場所を調べると、状態が変わるかと、元の場面に戻るか、別のシーンへ移ったか
/// （調べるシーンの中だけを進め、戻ったところで比べる）。values は name_values
fn changes(e: &Engine, x: u32, i: usize, n: usize, values: &[u64]) -> (bool, bool, bool) {
    let m = e.m;
    let s = &e.s;
    let mut h = Hasher128::new();
    for v in [u64::from(x), i as u64] {
        h.write(v);
    }
    // 別のシーンへ移りうる場所は、移った先が今の場面と同じかどうかも結果に効くので、今の場面も見分けに入れる
    if m.defer.sigs[&x][i].leaves {
        for v in [
            u64::from(s.scene),
            u64::from(s.pc),
            s.mode as u64,
            s.phase as u64,
            u64::from(s.statement),
        ] {
            h.write(v);
        }
    }
    for &v in values {
        h.write(v);
    }
    let key = h.finish();
    if let Some(&hit) = m.defer.cache.borrow().get(&key) {
        return hit;
    }
    let mut y = e.clone();
    let run = |y: &mut Engine| -> Res {
        y.inspect(x)?;
        y.choose(n)?;
        let mut k = 0;
        while k < CHAIN_LIMIT && y.s.inspect_from.is_some() && linear_static(m, &y.s) {
            y.advance()?;
            k += 1;
        }
        Ok(())
    };
    let ok = run(&mut y).is_ok() && y.s.inspect_from.is_none();
    let back = ok
        && (y.s.scene, y.s.pc, y.s.mode, y.s.phase, y.s.statement)
            == (s.scene, s.pc, s.mode, s.phase, s.statement);
    let out = (!ok || !same_state(m, s, &y.s), back, ok && !back);
    m.defer.cache.borrow_mut().insert(key, out);
    out
}

/// 調べる前と後で、この先の動きに効く状態が同じか（ライフ・文中の値・詳しく調べるシーンの visited は見ない）
fn same_state(m: &Model, a: &State, b: &State) -> bool {
    if (a.scene, a.pc, a.mode, a.phase, a.statement)
        != (b.scene, b.pc, b.mode, b.phase, b.statement)
    {
        return false;
    }
    if a.inspect_from.is_some() != b.inspect_from.is_some()
        || a.record_locked != b.record_locked
        || a.flags != b.flags
    {
        return false;
    }
    if a.evidence.len() != b.evidence.len()
        || !a.evidence.iter().all(|x| b.evidence.contains(x))
        || a.seen != b.seen
    {
        return false;
    }
    let (mut va, mut vb) = (a.visited.clone(), b.visited.clone());
    for ev in &m.evidence {
        if let Some(sc) = ev.inspect.filter(|&x| (x as usize) < m.scenes.len()) {
            va.remove(sc);
            vb.remove(sc);
        }
    }
    va == vb
}
