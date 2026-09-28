//! 法廷パートの表（証言・尋問・ゆさぶる・つきつける・体力）（tbl_court.py）。出力: tables/court.json

use std::collections::{BTreeMap, HashMap};

use super::{py_strip, tail_chars};
use crate::bytes::Result;
use crate::json::Json;
use crate::nds::Arm9;
use crate::script::{decode, text, Tok};
use crate::statics;

const PRESENT_TABLE: u32 = 0x020b44c8;
const GAMEOVER_TABLE: u32 = 0x020aad40;
const N_PARTS: usize = 35;
const COMMON_ITEM: usize = 72;
const COMMON_WRONG: [usize; 4] = [45, 46, 47, 48];
const TURN: [u16; 3] = [21, 69, 121];

type Ops = Vec<Tok>;

/// 項目を区画とラベルに分ける。ラベル = 見出しの末尾の、単調に増えない/大きさを超える値
pub fn split(e: &[u16]) -> (Vec<Vec<u16>>, BTreeMap<usize, [u32; 2]>) {
    let n = e[0] as usize | (e[1] as usize) << 16;
    let offs: Vec<usize> = (0..n).map(|k| e[2 + 2 * k] as usize | (e[3 + 2 * k] as usize) << 16).collect();
    let size = e.len() * 2;
    let mut real = n;
    for k in 1..n {
        if offs[k] < offs[k - 1] || offs[k] >= size {
            real = k;
            break;
        }
    }
    let mut bounds: Vec<usize> = offs[..real].iter().map(|o| o / 2).collect();
    bounds.push(e.len());
    let secs = (0..real).map(|k| e[bounds[k].min(bounds[k + 1])..bounds[k + 1]].to_vec()).collect();
    let labels = (real..n).map(|k| (k, [(offs[k] >> 16) as u32, (offs[k] & 0xffff) as u32])).collect();
    (secs, labels)
}

fn has(d: &Ops, op: u16, arg0: Option<u16>) -> bool {
    d.iter().any(|t| t.op() == Some(op) && arg0.is_none_or(|a| t.arg(0) == Some(a)))
}

fn first(d: &Ops, op: u16) -> Option<Vec<u16>> {
    d.iter().find_map(|t| match t {
        Tok::Op(o, a) if *o == op => Some(a.clone()),
        _ => None,
    })
}

/// 色 color の文（None なら全部）をつなげる
fn colored_text(d: &Ops, chars: &HashMap<u16, String>, color: Option<u16>) -> String {
    let mut cur = 0u16;
    let mut out = String::new();
    for t in d {
        match t {
            Tok::Op(3, a) => cur = a.first().copied().unwrap_or(0),
            Tok::Op(1, _) => out.push('\n'),
            Tok::Text(g) if color.is_none_or(|c| c == cur) => out.push_str(&text(g, chars)),
            _ => {}
        }
    }
    py_strip(&out).to_string()
}

/// 証言の題（赤い文のうち ～ で始まる行。無ければ最初の行）
fn title(d: &Ops, chars: &HashMap<u16, String>) -> String {
    let t = colored_text(d, chars, Some(1));
    let lines: Vec<&str> = t.split('\n').filter(|x| !py_strip(x).is_empty()).collect();
    lines.iter().find(|x| x.starts_with('～')).or(lines.first()).map_or(String::new(), |s| s.to_string())
}

struct Row {
    section: i64,
    item: u16,
    goto: i64,
    flag: Option<u8>,
    box_closed: bool,
    dead: bool,
}

impl Row {
    fn json(&self) -> Json {
        Json::obj().with("section", self.section).with("item", self.item).with("goto", self.goto).with("flag", self.flag)
            .with("box_closed", self.box_closed).with("dead", self.dead)
    }
}

fn read_present(a: &Arm9, part: usize) -> Result<Vec<Row>> {
    let mut p = a.u32(PRESENT_TABLE + 4 * part as u32)?;
    let mut rows = Vec::new();
    while a.u16(p)? != 0xffff {
        let b = a.read(p, 8)?;
        let (sec, item, dest) = (u16::from_le_bytes([b[0], b[1]]), u16::from_le_bytes([b[2], b[3]]), u16::from_le_bytes([b[4], b[5]]));
        rows.push(Row { section: sec as i64 - 128, item, goto: dest as i64 - 128, flag: (b[6] != 0xff).then_some(b[6]), box_closed: b[7] == 0, dead: item > 0xff });
        p += 8;
    }
    Ok(rows)
}

/// 法廷記録の番号 → evidence / profile（23/24/25 の使われ方から）
fn item_kinds(ents: &[Vec<u16>]) -> HashMap<u16, &'static str> {
    let mut kinds = HashMap::new();
    for e in ents.iter().step_by(2) {
        for s in split(e).0 {
            for t in decode(&s) {
                if let Tok::Op(23..=25, a) = t {
                    for x in a {
                        kinds.insert(x & 0x3fff, if x & 0x8000 != 0 { "profile" } else { "evidence" });
                    }
                }
            }
        }
    }
    kinds
}

/// ゆさぶりの区画の終わり方（戻り先）
fn press_end(d: &Ops) -> Option<Json> {
    for t in d.iter().rev() {
        let Tok::Op(op, a) = t else { continue };
        let g = |k: usize| a.get(k).copied().unwrap_or(0) as i64;
        match op {
            44 => return Some(Json::obj().with("op", "jump_after").with("goto", g(0) - 128)),
            42 => return Some(Json::obj().with("op", "testimony_jump").with("flag", g(0)).with("if_set", g(1) - 128).with("else", g(2) - 128)),
            10 | 32 => return Some(Json::obj().with("op", if *op == 10 { "page_jump" } else { "set_next" }).with("goto", g(0) - 128)),
            54 | 120 => return Some(Json::obj().with("op", "jump").with("label", g(0))),
            _ => {}
        }
    }
    None
}

/// 53 の引数（フラグ << 8 | 0x80? | 期待値, 飛び先）
fn flag53(a: &[u16]) -> Json {
    let (a0, a1) = (a.first().copied().unwrap_or(0), a.get(1).copied().unwrap_or(0));
    let j = Json::obj().with("flag", a0 >> 8).with("value", a0 & 1);
    if a0 & 0x80 != 0 { j.with("goto", a1) } else { j.with("skip_bytes", a1) }
}

fn flags53(d: &Ops) -> Vec<Json> {
    d.iter().filter_map(|t| match t {
        Tok::Op(53, a) => Some(flag53(a)),
        _ => None,
    }).collect()
}

/// 尋問の文: 15 を持つか、ページ送り（2/10/45）無しで 21/69/121 を持つ。つきつけ要求（17/33）は除く
fn is_statement(d: &Ops) -> bool {
    if has(d, 17, None) || has(d, 33, None) {
        return false;
    }
    has(d, 15, None) || (TURN.iter().any(|&o| has(d, o, None)) && ![2, 10, 45].iter().any(|&o| has(d, o, None)))
}

fn region(ds: &[Ops], k: usize) -> Vec<usize> {
    let mut out = Vec::new();
    for (j, d) in ds.iter().enumerate().skip(k + 1) {
        if has(d, 40, Some(1)) || has(d, 41, Some(1)) || has(d, 41, Some(0)) || has(d, 22, None) {
            break;
        }
        if is_statement(d) {
            out.push(j);
        }
    }
    out
}

/// 文の次の区画が文字の無い「つなぎ」（44/42/53 だけ）なら、その行き先
fn connector(d: &Ops) -> Option<Json> {
    if d.iter().any(|t| matches!(t, Tok::Text(_))) || TURN.iter().any(|&o| has(d, o, None)) {
        return None;
    }
    let r = press_end(d);
    let flags = flags53(d);
    if r.is_none() && flags.is_empty() {
        return None;
    }
    Some(r.unwrap_or_else(Json::obj).with("if_flags", flags))
}

fn labels_json(labels: &BTreeMap<usize, [u32; 2]>) -> Json {
    Json::Obj(labels.iter().map(|(k, v)| (k.to_string(), Json::from(v.to_vec()))).collect())
}

/// 区画の中の体力の減り（43 の数）とゲームオーバーの確かめ（122）
fn penalty(d: &Ops, labels: &BTreeMap<usize, [u32; 2]>) -> Json {
    let go = first(d, 122).map(|a| a.first().copied().unwrap_or(0));
    let loss = d.iter().filter(|t| t.op() == Some(43)).count();
    let g = go.map(|l| Json::obj().with("label", l).with("at", labels.get(&(l as usize)).map(|v| Json::from(v.to_vec()))));
    Json::obj().with("life_loss", loss).with("if_gameover", g)
}

/// Python の ds[i]（負なら後ろから）
fn py_at(ds: &[Ops], i: i64) -> Option<&Ops> {
    let j = if i < 0 { ds.len() as i64 + i } else { i };
    (j >= 0).then(|| ds.get(j as usize)).flatten()
}

mod part;
pub use part::export;
