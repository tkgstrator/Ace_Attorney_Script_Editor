// 状態を見分けるキー（verify-key.ts と同じものを見分ける）。文字列の代わりに 128 ビットのハッシュ値にする。
// キーに入れるのは、この先の動きを変えうるものだけ:
// - 今いる地点。尋問のシーンなら、証言の段階と番号も
// - その地点で生きている変数（flow.rs）。数値のフラグは、条件式で比べている範囲の外を 1 つにまとめる
// - 持っている証拠品（集まりとして）と人物ファイル（人物ファイルをつきつけられる所があるときだけ）。
//   証拠品を詳しく調べている途中なら、戻り先と、戻り先で生きている変数も
// - 法廷記録を使えなくしているか（詳しく調べられる証拠品があるときだけ）
use crate::flow::{Flow, Var};
use crate::model::*;
use crate::region::boolean_flags;
use crate::state::{Mode, Phase, State};

/// 数値のフラグごとの、区別が要る値の範囲（この外の値は lo-1 か hi+1 にまとめてよい）
#[derive(Clone, Copy, Debug)]
pub struct Bound {
    pub lo: f64,
    pub hi: f64,
    pub up: bool,
    pub down: bool,
}

/// flagBounds と同じ。比べ（== != < <= > >=）と真偽にしか使わないフラグだけ範囲を持つ
pub fn flag_bounds(m: &Model) -> Vec<Option<Bound>> {
    let n = m.flag_names.len();
    let mut range: Vec<Option<(f64, f64)>> = vec![None; n];
    let mut exact = vec![false; n];
    let mut note = |range: &mut Vec<Option<(f64, f64)>>, f: u32, v: f64| {
        let r = &mut range[f as usize];
        *r = Some(match *r { None => (v, v), Some((lo, hi)) => (lo.min(v), hi.max(v)) });
    };
    fn walk(e: Option<&Expr>, b: bool, range: &mut Vec<Option<(f64, f64)>>, exact: &mut [bool], note: &mut dyn FnMut(&mut Vec<Option<(f64, f64)>>, u32, f64)) {
        let Some(e) = e else { return };
        match e {
            Expr::Var(f) => if b { note(range, *f, 0.0) } else { exact[*f as usize] = true },
            Expr::Not(x) => walk(Some(x), true, range, exact, note),
            Expr::Table(t) => walk(Some(&t.orig), b, range, exact, note),
            Expr::Bin(op, l, r) => {
                let cmp = matches!(op, BinOp::Eq | BinOp::Ne | BinOp::Lt | BinOp::Le | BinOp::Gt | BinOp::Ge);
                if cmp {
                    if let (Expr::Var(f), Expr::Lit(FVal::Num(v))) = (&**l, &**r) { note(range, *f, *v); return; }
                    if let (Expr::Lit(FVal::Num(v)), Expr::Var(f)) = (&**l, &**r) { note(range, *f, *v); return; }
                }
                let logic = matches!(op, BinOp::And | BinOp::Or);
                walk(Some(l), logic, range, exact, note);
                walk(Some(r), logic, range, exact, note);
            }
            _ => {}
        }
    }
    let (mut up, mut down) = (vec![false; n], vec![false; n]);
    for sc in &m.scenes {
        for ins in &sc.program {
            match ins {
                Op::JumpUnless(c, _) => walk(Some(c), true, &mut range, &mut exact, &mut note),
                Op::Choice(o) => o.iter().for_each(|o| walk(o.when.as_ref(), true, &mut range, &mut exact, &mut note)),
                Op::Add(f, a) => if *a >= 0.0 { up[*f as usize] = true } else { down[*f as usize] = true },
                _ => {}
            }
        }
        let mut w = |e: Option<&Expr>| walk(e, true, &mut range, &mut exact, &mut note);
        match &sc.kind {
            Kind::Testimony(t) => t.statements.iter().for_each(|s| w(s.when.as_ref())),
            Kind::Place(p) => {
                p.person.iter().for_each(|x| w(x.as_ref()));
                p.moves.iter().for_each(|(_, x)| w(x.as_ref()));
                p.talk.iter().for_each(|x| w(x.when.as_ref()));
                p.examine.iter().for_each(|x| w(x.when.as_ref()));
            }
            Kind::Dialogue => {}
        }
    }
    (0..n).map(|f| {
        let (lo, hi) = range[f]?;
        // 増やすのも減らすのもあるフラグは、まとめた値から戻ってこられるので、まとめない
        if exact[f] || (up[f] && down[f]) { return None; }
        Some(Bound { lo, hi, up: !down[f], down: !up[f] })
    }).collect()
}

/// 128 ビットのハッシュ（掛け算を畳む方式を 2 本）
pub struct Hasher128 {
    a: u64,
    b: u64,
    n: u64,
}

#[inline]
fn fold(x: u64, k: u64) -> u64 {
    let r = u128::from(x) * u128::from(k);
    (r as u64) ^ ((r >> 64) as u64)
}

impl Hasher128 {
    pub fn new() -> Self {
        Hasher128 { a: 0x243f_6a88_85a3_08d3, b: 0x1319_8a2e_0370_7344, n: 0 }
    }
    #[inline]
    pub fn write(&mut self, x: u64) {
        self.n += 1;
        self.a = fold(self.a ^ x, 0xa076_1d64_78bd_642f);
        self.b = fold(self.b ^ x.rotate_left(29) ^ self.n, 0xe703_7ed1_a0b4_28db).rotate_left(17);
    }
    pub fn finish(&self) -> u128 {
        let a = fold(self.a ^ self.n, 0x8ebc_6af0_9c88_c6e3);
        let b = fold(self.b ^ a, 0x5899_65cc_7537_4cc3);
        u128::from(a) << 64 | u128::from(b)
    }
}

impl Default for Hasher128 {
    fn default() -> Self { Self::new() }
}

/// 生きている変数の集まりごとの、キーの作り方（種類ごとに分けて並べる）
struct Plan {
    bools: Vec<u32>,
    visits: Vec<u32>,
    seens: Vec<u32>,
    others: Vec<u32>,
}

pub struct KeyMaker<'a> {
    m: &'a Model,
    pub flow: &'a Flow,
    bounds: Vec<Option<Bound>>,
    plans: Vec<Plan>,
    ev_words: usize,
    /// キーに入れる証拠品・人物ファイル（人物ファイルをつきつけられる所がなければ、人物ファイルは入れない）
    ev_mask: Vec<u64>,
    /// 法廷記録の鍵をキーに入れるか
    lock: bool,
}

impl<'a> KeyMaker<'a> {
    pub fn new(m: &'a Model, flow: &'a Flow) -> KeyMaker<'a> {
        let bool_flags = boolean_flags(m);
        let plans = flow.live_sets().iter().map(|set| {
            let mut p = Plan { bools: vec![], visits: vec![], seens: vec![], others: vec![] };
            for &i in set {
                match flow.vars[i as usize] {
                    Var::Flag(f) if bool_flags[f as usize] => p.bools.push(f),
                    Var::Flag(f) => p.others.push(f),
                    Var::Visit(x) => p.visits.push(x),
                    Var::Seen(x) => p.seens.push(x),
                }
            }
            p
        }).collect();
        let ev_words = m.evidence.len().div_ceil(64).max(1);
        let mut ev_mask = vec![0u64; ev_words];
        for (i, e) in m.evidence.iter().enumerate() { if !e.profile || m.profile_points { ev_mask[i >> 6] |= 1 << (i & 63); } }
        let lock = m.evidence.iter().any(|e| e.inspect.is_some());
        KeyMaker { m, flow, bounds: flag_bounds(m), plans, ev_words, ev_mask, lock }
    }

    /// 地点 node で生きている変数の値をハッシュに入れる（集まりごとに並びが決まっているので、値だけを入れる）
    fn vars(&self, h: &mut Hasher128, s: &State, node: u32) {
        let p = &self.plans[self.flow.live_set_of(node) as usize];
        let (mut word, mut count) = (0u64, 0);
        let mut bit = |on: bool, h: &mut Hasher128| {
            word |= u64::from(on) << count;
            count += 1;
            if count == 64 { h.write(word); word = 0; count = 0; }
        };
        for &f in &p.bools { bit(s.flags[f as usize] == FVal::Bool(true), h); }
        for &x in &p.visits { bit(s.visited.has(x), h); }
        for &x in &p.seens { bit(s.seen.has(x), h); }
        h.write(word);
        for &f in &p.others { self.other(h, f, s.flags[f as usize]); }
    }

    /// 真偽とは限らないフラグの値（範囲の外はまとめる）
    fn other(&self, h: &mut Hasher128, f: u32, v: FVal) {
        match v {
            FVal::Undef => h.write(0),
            FVal::Bool(b) => h.write(1 + u64::from(b)),
            FVal::Str(i) => { h.write(3); h.write(u64::from(i)); }
            FVal::Num(mut n) => {
                if let Some(b) = self.bounds[f as usize] {
                    if b.up && n > b.hi { n = b.hi + 1.0 } else if b.down && n < b.lo { n = b.lo - 1.0 }
                }
                // String(v) と同じく、-0 と 0・NaN どうしは同じ
                let bits = if n == 0.0 { 0 } else if n.is_nan() { 1 } else { n.to_bits() };
                h.write(4);
                h.write(bits);
            }
        }
    }

    pub fn key(&self, s: &State) -> u128 {
        let mut h = Hasher128::new();
        let node = self.flow.node_of(s.scene, s.pc, s.mode);
        h.write(u64::from(node));
        if matches!(self.m.scenes.get(s.scene as usize).map(|x| &x.kind), Some(Kind::Testimony(_))) {
                h.write(phase_code(s.phase) << 32 | u64::from(s.statement));
        }
        self.vars(&mut h, s, node);
        if let Some(f) = s.inspect_from {
            let back = self.flow.node_of(f.scene, f.pc, f.mode);
            h.write(u64::MAX);
            h.write(u64::from(back));
            if f.mode == Mode::Testimony { h.write(phase_code(f.phase) << 32 | u64::from(f.statement)); }
            self.vars(&mut h, s, back);
        }
        // 証拠品は 256 個までなら、割り当てなしで作る
        let mut small = [0u64; 4];
        let mut big = vec![];
        let ev: &mut [u64] = if self.ev_words <= 4 { &mut small[..self.ev_words] } else { big.resize(self.ev_words, 0); &mut big };
        for &e in &s.evidence { ev[e as usize >> 6] |= 1 << (e & 63); }
        // 生きている証拠品だけを入れる（evflow.rs。詳しく調べている途中なら、戻り先で生きているものも）
        if let Some(live) = self.flow.live_ev(node) {
            let back = s.inspect_from.map(|f| self.flow.live_ev(self.flow.node_of(f.scene, f.pc, f.mode)).unwrap());
            for (w, x) in ev.iter_mut().enumerate() { *x &= live[w] | back.map_or(0, |b| b[w]); }
        }
        for (w, x) in ev.iter().enumerate() { h.write(*x & self.ev_mask[w]); }
        if self.lock { h.write(u64::from(s.record_locked)); }
        h.finish()
    }
}

fn phase_code(p: Phase) -> u64 {
    match p { Phase::Intro => 0, Phase::Reading => 1, Phase::CrossIntro => 2, Phase::Cross => 3 }
}
