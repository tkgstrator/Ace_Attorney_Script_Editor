// ゲームの状態のうち、調べるのに使うものだけ（表示・音は持たない。人物ファイルは証拠品と一緒に持つ）と、
// それを小さなバイト列に詰める処理。
use crate::model::{FVal, Model};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Mode {
    Run,
    Testimony,
    Investigate,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Phase {
    Intro,
    Reading,
    CrossIntro,
    Cross,
}

/// 証拠品を詳しく調べ始めた場面。証言・尋問の途中なら、その段階と証言の番号も（戻るときに戻す）。
/// var_ev は、戻るときに戻す文中の {evidence}（表示だけに使う）
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Frame {
    pub scene: u32,
    pub pc: u32,
    pub mode: Mode,
    pub phase: Phase,
    pub statement: u32,
    pub var_ev: Option<u32>,
}

/// 決まった大きさのビットの集まり
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Bits(pub Vec<u64>);

impl Bits {
    pub fn new(n: usize) -> Bits {
        Bits(vec![0; n.div_ceil(64).max(1)])
    }
    #[inline]
    pub fn has(&self, i: u32) -> bool {
        self.0.get((i >> 6) as usize).is_some_and(|w| w >> (i & 63) & 1 == 1)
    }
    #[inline]
    pub fn add(&mut self, i: u32) -> bool {
        let w = &mut self.0[(i >> 6) as usize];
        let was = *w >> (i & 63) & 1 == 1;
        *w |= 1 << (i & 63);
        !was
    }
    #[inline]
    pub fn remove(&mut self, i: u32) {
        self.0[(i >> 6) as usize] &= !(1 << (i & 63));
    }
    /// self にあって before にないもの
    pub fn added_since<'a>(&'a self, before: &'a Bits) -> impl Iterator<Item = u32> + 'a {
        self.0.iter().zip(before.0.iter()).enumerate().flat_map(|(wi, (a, b))| {
            let mut d = a & !b;
            std::iter::from_fn(move || {
                if d == 0 { return None; }
                let t = d.trailing_zeros();
                d &= d - 1;
                Some((wi as u32) << 6 | t)
            })
        })
    }
    pub fn iter(&self) -> impl Iterator<Item = u32> + '_ {
        let zero = Bits(vec![0; self.0.len()]);
        self.added_since(&zero).collect::<Vec<_>>().into_iter()
    }
}

#[derive(Clone, Debug)]
pub struct State {
    pub scene: u32,
    pub pc: u32,
    pub mode: Mode,
    pub phase: Phase,
    pub statement: u32,
    pub inspect_from: Option<Frame>,
    pub life: f64,
    /// 文中の {evidence} に差し込む証拠品（表示だけに使う）
    pub var_ev: Option<u32>,
    pub flags: Vec<FVal>,
    /// 持っている証拠品と人物ファイル（手に入れた順。見当違いのつきつけに使う証拠品の選び方が並びによる）
    pub evidence: Vec<u32>,
    /// 法廷記録を使えなくしているか（ui の record。詳しく調べられるかに効く）
    pub record_locked: bool,
    pub visited: Bits,
    pub seen: Bits,
}

impl State {
    pub fn initial(m: &Model) -> State {
        State {
            scene: m.start_scene, pc: 0, mode: Mode::Run, phase: Phase::Intro, statement: 0, inspect_from: None,
            life: m.max_life, var_ev: None, flags: m.flag_init.clone(), evidence: m.start_evidence.clone(), record_locked: false,
            visited: Bits::new(m.visit_count()), seen: Bits::new(m.seen_ids.len()),
        }
    }
    /// o の中身を写す（割り当て済みの領域を使い回す）
    pub fn copy_from(&mut self, o: &State) {
        self.scene = o.scene;
        self.pc = o.pc;
        self.mode = o.mode;
        self.phase = o.phase;
        self.statement = o.statement;
        self.inspect_from = o.inspect_from;
        self.life = o.life;
        self.var_ev = o.var_ev;
        self.flags.clone_from(&o.flags);
        self.evidence.clone_from(&o.evidence);
        self.record_locked = o.record_locked;
        self.visited.0.clone_from(&o.visited.0);
        self.seen.0.clone_from(&o.seen.0);
    }

    pub fn holds(&self, ev: u32) -> bool {
        self.evidence.contains(&ev)
    }
}

// ---- 詰める ----------------------------------------------------------------------

fn mode_code(m: Mode) -> u8 {
    match m { Mode::Run => 0, Mode::Testimony => 1, Mode::Investigate => 2 }
}
fn mode_of(c: u8) -> Mode {
    match c { 0 => Mode::Run, 1 => Mode::Testimony, _ => Mode::Investigate }
}
fn phase_code(p: Phase) -> u8 {
    match p { Phase::Intro => 0, Phase::Reading => 1, Phase::CrossIntro => 2, Phase::Cross => 3 }
}
fn phase_of(c: u8) -> Phase {
    match c { 0 => Phase::Intro, 1 => Phase::Reading, 2 => Phase::CrossIntro, _ => Phase::Cross }
}

fn varint(out: &mut Vec<u8>, mut v: u64) {
    while v >= 0x80 { out.push(v as u8 | 0x80); v >>= 7; }
    out.push(v as u8);
}
fn read_varint(b: &[u8], at: &mut usize) -> u64 {
    let (mut v, mut s) = (0u64, 0);
    loop {
        let x = b[*at];
        *at += 1;
        v |= u64::from(x & 0x7f) << s;
        if x < 0x80 { return v; }
        s += 7;
    }
}

/// 状態を詰める。フラグは 2 ビットの種類（undefined / false / true / そのほか）と、そのほかの値の並び
pub fn pack(s: &State) -> Box<[u8]> {
    let mut out = Vec::with_capacity(64 + s.flags.len() / 4 + s.evidence.len() * 2);
    varint(&mut out, u64::from(s.scene));
    varint(&mut out, u64::from(s.pc));
    out.push(mode_code(s.mode) | phase_code(s.phase) << 2 | u8::from(s.inspect_from.is_some()) << 4 | u8::from(s.var_ev.is_some()) << 5
        | u8::from(s.record_locked) << 6);
    varint(&mut out, u64::from(s.statement));
    if let Some(f) = s.inspect_from {
        varint(&mut out, u64::from(f.scene));
        varint(&mut out, u64::from(f.pc));
        out.push(mode_code(f.mode) | phase_code(f.phase) << 2 | u8::from(f.var_ev.is_some()) << 4);
        varint(&mut out, u64::from(f.statement));
        if let Some(v) = f.var_ev { varint(&mut out, u64::from(v)); }
    }
    if let Some(v) = s.var_ev { varint(&mut out, u64::from(v)); }
    out.extend_from_slice(&s.life.to_le_bytes());
    let mut kinds = vec![0u8; s.flags.len().div_ceil(4)];
    let mut rest = vec![];
    for (i, v) in s.flags.iter().enumerate() {
        let k = match v {
            FVal::Undef => 0,
            FVal::Bool(false) => 1,
            FVal::Bool(true) => 2,
            FVal::Num(n) => { rest.push(0); rest.extend_from_slice(&n.to_le_bytes()); 3 }
            FVal::Str(x) => { rest.push(1); rest.extend_from_slice(&x.to_le_bytes()); 3 }
        };
        kinds[i / 4] |= k << (i % 4 * 2);
    }
    out.extend_from_slice(&kinds);
    out.extend_from_slice(&rest);
    varint(&mut out, s.evidence.len() as u64);
    for e in &s.evidence { varint(&mut out, u64::from(*e)); }
    for bits in [&s.visited, &s.seen] {
        for w in &bits.0 { varint(&mut out, *w); }
    }
    out.into_boxed_slice()
}

pub fn unpack(b: &[u8], m: &Model) -> State {
    let mut at = 0;
    let scene = read_varint(b, &mut at) as u32;
    let pc = read_varint(b, &mut at) as u32;
    let head = b[at];
    at += 1;
    let statement = read_varint(b, &mut at) as u32;
    let inspect_from = (head >> 4 & 1 == 1).then(|| {
        let scene = read_varint(b, &mut at) as u32;
        let pc = read_varint(b, &mut at) as u32;
        let h = b[at];
        at += 1;
        let statement = read_varint(b, &mut at) as u32;
        let var_ev = (h >> 4 & 1 == 1).then(|| read_varint(b, &mut at) as u32);
        Frame { scene, pc, mode: mode_of(h & 3), phase: phase_of(h >> 2 & 3), statement, var_ev }
    });
    let var_ev = (head >> 5 & 1 == 1).then(|| read_varint(b, &mut at) as u32);
    let life = f64::from_le_bytes(b[at..at + 8].try_into().unwrap());
    at += 8;
    let n = m.flag_names.len();
    let kinds = &b[at..at + n.div_ceil(4)];
    at += n.div_ceil(4);
    let mut flags = Vec::with_capacity(n);
    for i in 0..n {
        flags.push(match kinds[i / 4] >> (i % 4 * 2) & 3 {
            0 => FVal::Undef,
            1 => FVal::Bool(false),
            2 => FVal::Bool(true),
            _ => {
                let tag = b[at];
                at += 1;
                if tag == 0 {
                    let v = f64::from_le_bytes(b[at..at + 8].try_into().unwrap());
                    at += 8;
                    FVal::Num(v)
                } else {
                    let v = u32::from_le_bytes(b[at..at + 4].try_into().unwrap());
                    at += 4;
                    FVal::Str(v)
                }
            }
        });
    }
    let ne = read_varint(b, &mut at) as usize;
    let evidence = (0..ne).map(|_| read_varint(b, &mut at) as u32).collect();
    let mut visited = Bits::new(m.visit_count());
    for w in visited.0.iter_mut() { *w = read_varint(b, &mut at); }
    let mut seen = Bits::new(m.seen_ids.len());
    for w in seen.0.iter_mut() { *w = read_varint(b, &mut at); }
    State {
        scene, pc, mode: mode_of(head & 3), phase: phase_of(head >> 2 & 3), statement, inspect_from, life, var_ev, flags,
        evidence, record_locked: head >> 6 & 1 == 1, visited, seen,
    }
}
