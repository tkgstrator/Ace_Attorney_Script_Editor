//! 探偵パートの「パートごとのコード」を記号的に実行して、条件（フラグ）と動作の組に直す（tbl_invest_sym.py）。
//!
//! Python 版は capstone の文字列（ニーモニックと引数）を読んで進めるので、ここでも armdis.rs で同じ文字列を作り、
//! 同じ読み方（シフトを無視するなどの癖も含めて）をする。
//! - r0 = ゲーム全体の状態（0x020ceda8）。+0x68 = 今の場所、+0x69 = パート（具体的な値で実行）
//! - bl 0x0201a144(組, 番号) = フラグを調べる → 記号にして、後の cmp で道を 2 つに分ける
//! - ほかの bl は「動作」として引数（r0〜r3）を記録する

use std::collections::HashMap;

use super::armdis::disasm;
use super::capstone_text::{imm_of, match_mem, parse_int0, split_mn, split_ops};
use crate::bytes::Result;
use crate::nds::Arm9;

const GAME: u32 = 0x020ceda8;
const FLAG_TEST: i64 = 0x0201a144;
const INLINE: [i64; 3] = [0x02068690, 0x02096a9c, 0x020973e0];

/// 動作として記録する関数（番地 → 名前。None は記録しない）
fn call_name(t: i64) -> Option<Option<&'static str>> {
    Some(Some(match t {
        0x0202887c => "event",
        0x02028850 => "event_keep_bgm",
        0x020288ac => "char",
        0x02025878 => "bgm",
        0x020258f8 => "se",
        0x02007498 => "copy",
        0x0200744c => "fill",
        0x0201a170 => "set_flag",
        0x0202232c => "op_2232c",
        0x0201ec34 => "bg_prepare",
        0x0201e168 | 0x0201cf10 => "bg",
        0x0202578c => "bgm_stop",
        0x02022530 => "char_raw",
        0x02036410 => "ui_36410",
        0x02023960 => "load_part",
        0x020250d0 => return Some(None),
        _ => return None,
    }))
}

/// 記号の値（None = 不明）
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum V {
    Int(i64),
    Game,
    GameOff(i64),
    Flag(i64, i64),
}

type Val = Option<V>;

fn py_str(v: &Val) -> String {
    match v {
        None => "None".into(),
        Some(V::Int(i)) => i.to_string(),
        Some(V::Game) => "game".into(),
        Some(V::GameOff(o)) => format!("('game', {o})"),
        Some(V::Flag(g, n)) => format!("('flag', ({g}, {n}))"),
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Cond {
    Flag((i64, i64), i64),
    Lang(&'static str),
    Other(String, bool),
}

/// 動作 (名前, 引数)。引数は整数か None
#[derive(Debug, Clone, PartialEq)]
pub struct Act {
    pub name: String,
    pub args: Vec<Option<i64>>,
}

#[derive(Clone)]
struct Path {
    regs: HashMap<String, V>,
    cond: Vec<Cond>,
    acts: Vec<Act>,
    flags: HashMap<(i64, i64), i64>,
    part: i64,
    stack: Vec<u32>,
    cmp: Option<(Val, Val)>,
}

impl Path {
    fn get(&self, r: &str) -> Val {
        self.regs.get(r).cloned()
    }
    fn set(&mut self, r: &str, v: Val) {
        match v {
            Some(v) => {
                self.regs.insert(r.to_string(), v);
            }
            None => {
                self.regs.remove(r);
            }
        }
    }
}

/// 道: (条件の一覧, 動作の一覧)
pub type Way = (Vec<Cond>, Vec<Act>);

fn cond_true(c: &str, a: i64, b: i64) -> bool {
    let (ua, ub) = (a as u64 & 0xffff_ffff, b as u64 & 0xffff_ffff);
    let (sa, sb) = (ua as u32 as i32, ub as u32 as i32);
    match c {
        "eq" => ua == ub,
        "ne" => ua != ub,
        "hs" | "cs" => ua >= ub,
        "lo" | "cc" => ua < ub,
        "hi" => ua > ub,
        "ls" => ua <= ub,
        "ge" => sa >= sb,
        "lt" => sa < sb,
        "gt" => sa > sb,
        "le" => sa <= sb,
        "mi" => (ua.wrapping_sub(ub)) & 0x8000_0000 != 0,
        "pl" => (ua.wrapping_sub(ub)) & 0x8000_0000 == 0,
        _ => false,
    }
}

fn val(p: &Path, s: &str) -> Val {
    let s = s.trim();
    if s.starts_with('#') {
        return imm_of(s).map(V::Int);
    }
    p.get(s)
}

enum Res {
    Next,
    Ret,
    Jump(i64),
    Call(i64),
    Fork,
}

fn constrain(p: &mut Path, cc: &str, truth: bool) {
    let (a, b) = p.cmp.clone().unwrap_or((None, None));
    if let (Some(V::Flag(g, n)), Some(V::Int(0))) = (&a, &b) {
        if cc == "eq" || cc == "ne" {
            let v = if (cc == "eq") == truth { 0 } else { 1 };
            p.cond.push(Cond::Flag((*g, *n), v));
            p.flags.insert((*g, *n), v);
            p.cmp = Some((Some(V::Int(v)), Some(V::Int(0))));
            return;
        }
    }
    if a == Some(V::GameOff(4)) && b == Some(V::Int(1)) && (cc == "eq" || cc == "ne") {
        // game+4 = 1 のとき英語
        let en = (cc == "eq") == truth;
        p.cond.push(Cond::Lang(if en { "en" } else { "ja" }));
        p.cmp = Some((Some(V::Int(if en { 1 } else { 0 })), Some(V::Int(1))));
        return;
    }
    p.cond.push(Cond::Other(
        format!("{} {cc} {}", py_str(&a), py_str(&b)),
        truth,
    ));
}

fn step(a9: &Arm9, p: &mut Path, pc: u32, base: &str, ops: &str, place: i64) -> Result<Res> {
    match base {
        "push" | "stm" | "str" | "strb" | "strh" | "cmn" | "tst" | "nop" => return Ok(Res::Next),
        "bx" => {
            return Ok(if ops.trim() == "lr" {
                Res::Ret
            } else {
                Res::Fork
            })
        }
        "pop" | "ldm" => {
            return Ok(if ops.contains("pc") {
                Res::Ret
            } else {
                Res::Next
            })
        }
        "b" => return Ok(Res::Jump(imm_of(ops).unwrap_or(0))),
        "bl" => {
            let tgt = imm_of(ops).unwrap_or(0);
            let args = [p.get("r0"), p.get("r1"), p.get("r2"), p.get("r3")];
            if INLINE.contains(&tgt) {
                return Ok(Res::Call(tgt));
            }
            let ints: Vec<Option<i64>> = args
                .iter()
                .map(|a| match a {
                    Some(V::Int(i)) => Some(*i),
                    _ => None,
                })
                .collect();
            if tgt == FLAG_TEST && ints[0].is_some() && ints[1].is_some() {
                let fl = (ints[0].unwrap(), ints[1].unwrap());
                let v = match p.flags.get(&fl) {
                    Some(&x) => V::Int(x),
                    None => V::Flag(fl.0, fl.1),
                };
                p.set("r0", Some(v));
            } else if call_name(tgt) == Some(None) {
                p.set("r0", None);
            } else {
                let name = match call_name(tgt) {
                    Some(Some(n)) => n.to_string(),
                    _ => format!("call_{tgt:08x}"),
                };
                p.acts.push(Act {
                    name,
                    args: ints.clone(),
                });
                if tgt == 0x0201a170 && ints[..3].iter().all(Option::is_some) {
                    p.flags
                        .insert((ints[0].unwrap(), ints[1].unwrap()), ints[2].unwrap());
                }
                if tgt == 0x02023960 {
                    if let Some(x) = ints[0] {
                        p.part = x;
                    }
                }
                p.set("r0", None);
            }
            for r in ["r1", "r2", "r3", "ip", "lr"] {
                p.set(r, None);
            }
            return Ok(Res::Next);
        }
        _ => {}
    }
    let parts = split_ops(ops);
    let first = parts[0].clone();
    match base {
        "mov" | "movs" | "mvn" => {
            let mut v = if parts.len() == 2 {
                val(p, &parts[1])
            } else {
                None
            };
            if base == "mvn" {
                if let Some(V::Int(i)) = v {
                    v = Some(V::Int(!i & 0xffff_ffff));
                }
            }
            if first == "pc" {
                return Ok(Res::Fork);
            }
            p.set(&first, v.clone());
            if base == "movs" {
                p.cmp = Some((v, Some(V::Int(0))));
            }
        }
        "ldr" if ops.contains("[pc") => {
            let imm = if ops.contains('#') {
                parse_int0(ops.rsplit('#').next().unwrap().trim_end_matches(']')).unwrap_or(0)
            } else {
                0
            };
            let addr = ((pc as i64 + 8) & !3) + imm;
            let w = a9.u32(addr as u32)?;
            p.set(
                &first,
                Some(if w == GAME { V::Game } else { V::Int(w as i64) }),
            );
        }
        b if b.starts_with("ldr") => {
            let mut v = None;
            if let Some((r, off)) = parts.get(1).and_then(|s| match_mem(s)) {
                if p.get(&r) == Some(V::Game) {
                    let off = off.unwrap_or(0);
                    v = Some(if off == 0x68 {
                        V::Int(place)
                    } else if off == 0x69 {
                        V::Int(p.part)
                    } else {
                        V::GameOff(off)
                    });
                }
            }
            p.set(&first, v);
        }
        "cmp" => {
            let b = parts.get(1).and_then(|s| val(p, s));
            p.cmp = Some((val(p, &first), b));
        }
        "add" | "sub" | "adds" | "subs" | "and" | "ands" | "orr" | "bic" | "lsl" | "lsr" => {
            if first == "pc" {
                // addls pc, pc, rX, lsl #2: 表による分岐
                return Ok(match parts.get(2).and_then(|s| val(p, s)) {
                    Some(V::Int(rx)) => Res::Jump(pc as i64 + 8 + rx * 4),
                    _ => Res::Fork,
                });
            }
            let a = parts.get(1).and_then(|s| val(p, s));
            let b = parts.get(2).and_then(|s| val(p, s));
            let mut v = None;
            if let (Some(V::Int(a)), Some(V::Int(b))) = (&a, &b) {
                let (a, b) = (*a, *b);
                let r = match base.trim_end_matches('s') {
                    "add" => a.wrapping_add(b),
                    "sub" => a.wrapping_sub(b),
                    "and" => a & b,
                    "orr" => a | b,
                    "bic" => a & !b,
                    "lsl" => {
                        if b < 63 {
                            a.wrapping_shl(b as u32)
                        } else {
                            0
                        }
                    }
                    _ => {
                        if b < 63 {
                            a >> b
                        } else {
                            0
                        }
                    }
                };
                v = Some(V::Int(r & 0xffff_ffff));
            }
            p.set(&first, v.clone());
            if matches!(base, "adds" | "subs" | "ands") {
                p.cmp = Some((v, Some(V::Int(0))));
            }
        }
        _ => {
            // そのほか（mul など）は結果を不明にする
            p.set(&first, None);
        }
    }
    Ok(Res::Next)
}

/// func を place / part の具体的な値で記号的に実行し、道の一覧を返す
pub fn run(a9: &Arm9, func: u32, place: i64, part: i64) -> Result<Vec<Way>> {
    const MAX_STEPS: usize = 4000;
    let mut done: Vec<Path> = Vec::new();
    let mut regs = HashMap::new();
    regs.insert("r0".to_string(), V::Game);
    let start = Path {
        regs,
        cond: vec![],
        acts: vec![],
        flags: HashMap::new(),
        part,
        stack: vec![],
        cmp: None,
    };
    let mut work: Vec<(u32, Path)> = vec![(func, start)];
    while let Some((mut pc, mut p)) = work.pop() {
        let mut steps = 0;
        loop {
            steps += 1;
            if steps > MAX_STEPS {
                p.acts.push(Act {
                    name: "too_long".into(),
                    args: vec![Some(pc as i64)],
                });
                done.push(p);
                break;
            }
            let Some((mn, ops)) = disasm(a9.u32(pc)?, pc) else {
                p.acts.push(Act {
                    name: "bad".into(),
                    args: vec![Some(pc as i64)],
                });
                done.push(p);
                break;
            };
            let (base, cc) = split_mn(&mn);
            let nxt = pc.wrapping_add(4);
            if !cc.is_empty() {
                let r = match &p.cmp {
                    Some((Some(V::Int(a)), Some(V::Int(b)))) => Some(cond_true(&cc, *a, *b)),
                    _ => None,
                };
                match r {
                    None => {
                        // 条件が記号 → 2 つの道に分ける
                        let mut q = p.clone();
                        constrain(&mut p, &cc, true);
                        constrain(&mut q, &cc, false);
                        work.push((nxt, q));
                    }
                    Some(false) => {
                        pc = nxt;
                        continue;
                    }
                    Some(true) => {}
                }
            }
            match step(a9, &mut p, pc, &base, &ops, place)? {
                Res::Ret => {
                    if let Some(r) = p.stack.pop() {
                        pc = r;
                        continue;
                    }
                    done.push(p);
                    break;
                }
                Res::Jump(t) => {
                    pc = t as u32;
                    continue;
                }
                Res::Call(t) => {
                    p.stack.push(nxt);
                    pc = t as u32;
                    continue;
                }
                Res::Fork => {
                    p.acts.push(Act {
                        name: "unknown_switch".into(),
                        args: vec![Some(pc as i64)],
                    });
                    done.push(p);
                    break;
                }
                Res::Next => pc = nxt,
            }
        }
    }
    Ok(done.into_iter().map(|p| (p.cond, p.acts)).collect())
}
