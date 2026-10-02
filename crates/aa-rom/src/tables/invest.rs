//! 探偵パート（移動する・話す・調べる・つきつける）の表（tbl_invest.py）。出力: tables/investigation.json
//!
//! 文字認識（--ocr）は開発のときだけのものなので行わない（name_ocr / ocr は null）。

use std::collections::BTreeMap;

use super::invest_sym::{run, Act, Cond, Way};
use crate::bytes::{i16_at, u16_at, Result};
use crate::json::Json;
use crate::nds::Arm9;
use crate::statics;

const PARTS: u32 = 35;
const T_INIT: u32 = 0x020b443c;
const T_ARRIVE: u32 = 0x020b466c;
const T_FRAME: u32 = 0x020b46f8;
const T_PRESENT: u32 = 0x020b45e0;
const T_RECORD: u32 = 0x020b4554;
const T_COURT_PRESENT: u32 = 0x020b44c8;
const NOP: u32 = 0x0202884c;
const PLACES_RAM: i64 = 0x020ceeb0;
const TALK_RAM: i64 = 0x020ce8a8;
const EXAMINE_RAM: i64 = 0x020ceb28;
const TEX_STEP: usize = 0x8b4;
const PLACE_TEX: [usize; 2] = [0x026a23c8, 0x026b1778];
const TOPIC_TEX: [usize; 2] = [0x026c0b28, 0x02726f58];
const THUMB_TEX: [usize; 2] = [0x0278d388, 0x02804fcc];
const THUMB_STEP: usize = 0x4214;
const N_PLACE_TEX: usize = 28;
const N_TOPIC_TEX: usize = 188;
const COURT_POINT: u32 = 0x020aafd0;

/// ほかの手順が書き出したファイルの名前（Python 版はフォルダーを見に行く）
pub struct Refs<'a> {
    /// data/tail/tex/ の PNG の名前
    pub tex_pngs: &'a [String],
    /// script/bg_map.tsv の中身（無ければ None）
    pub bg_map: Option<&'a str>,
    /// JSON に書くパスの頭（Python 版と同じ「assets/extracted」）
    pub prefix: &'a str,
}

fn sec(v: Option<i64>) -> Json {
    match v {
        None | Some(0xffff) => Json::Null,
        Some(v) => Json::obj()
            .with("raw", v)
            .with("script", if v >= 0x80 { "story" } else { "common" })
            .with("section", if v >= 0x80 { v - 0x80 } else { v }),
    }
}

fn tex(r: &Refs, base: usize, i: usize, step: usize) -> Json {
    let a = base + i * step;
    let pre = format!("{a:x}");
    let mut hits: Vec<&String> = r.tex_pngs.iter().filter(|n| n.starts_with(&pre)).collect();
    hits.sort();
    Json::obj().with("data_bin", format!("{a:#x}")).with(
        "png",
        hits.first()
            .map(|h| format!("{}/data/tail/tex/{h}", r.prefix)),
    )
}

fn copies(a9: &Arm9, func: u32, part: i64) -> Result<BTreeMap<i64, (i64, i64)>> {
    let mut out = BTreeMap::new();
    for (_, acts) in run(a9, func, 0, part)? {
        for act in acts {
            if act.name == "copy"
                && act.args.len() >= 3
                && act.args[..3].iter().all(Option::is_some)
            {
                out.insert(
                    act.args[1].unwrap(),
                    (act.args[0].unwrap(), act.args[2].unwrap()),
                );
            }
        }
    }
    Ok(out)
}

fn parse_places(d: &[u8]) -> Vec<(usize, u8, Vec<u8>)> {
    (0..d.len() / 8)
        .filter(|i| d[i * 8 + 1..i * 8 + 4] == [0xff, 0xff, 0xff])
        .map(|i| {
            (
                i,
                d[i * 8],
                d[i * 8 + 4..i * 8 + 8]
                    .iter()
                    .copied()
                    .filter(|&x| x != 0xff)
                    .collect(),
            )
        })
        .collect()
}

fn parse_talk(d: &[u8]) -> Vec<Json> {
    let mut out = Vec::new();
    for i in 0..d.len() / 0x14 {
        let e = &d[i * 0x14..i * 0x14 + 0x14];
        if e[0] == 0xff {
            break;
        }
        let topics: Vec<Json> = (0..4)
            .filter(|&k| e[4 + k] != 0xff)
            .map(|k| {
                let s = u16::from_le_bytes([e[12 + 2 * k], e[13 + 2 * k]]) as i64;
                Json::obj()
                    .with("topic", e[4 + k])
                    .with("read_flag", e[8 + k])
                    .with("section", sec(Some(s)))
            })
            .collect();
        out.push(
            Json::obj()
                .with("id", i)
                .with("place", e[0])
                .with("person", e[1])
                .with("active", e[3] == 1)
                .with("topics", topics),
        );
    }
    out
}

fn parse_examine(d: &[u8]) -> Result<Json> {
    let conds = statics::get("invest_examine_cond");
    let mut out = Vec::new();
    for i in 0..d.len() / 0x14 {
        let b = i * 0x14;
        let (s, kind, cond) = (u16_at(d, b)? as i64, d[b + 2], d[b + 3]);
        if kind == 0xff {
            break;
        }
        let pts: Vec<i16> = (0..8)
            .map(|j| i16_at(d, b + 4 + 2 * j))
            .collect::<Result<_>>()?;
        let k = match kind {
            0xfd => "cond",
            0xfe => "off",
            _ => "normal",
        };
        let quad: Vec<Json> = (0..4)
            .map(|j| Json::from(vec![pts[2 * j], pts[2 * j + 1]]))
            .collect();
        let mut e = Json::obj()
            .with("section", sec(Some(s)))
            .with("kind", k)
            .with("quad", quad);
        if kind == 0xfd {
            e.set(
                "cond",
                conds
                    .get(&cond.to_string())
                    .cloned()
                    .unwrap_or_else(|| Json::from(format!("never ({cond:#x})"))),
            );
        } else if kind != 0 && kind != 0xfe {
            e.set("b2", kind); // 第 5 話の表では場所の番号が入っている（判定には使わない）
        }
        out.push(e);
    }
    Ok(Json::Arr(out))
}

fn parse_present(a9: &Arm9, mut addr: u32) -> Result<Vec<Json>> {
    let mut out = Vec::new();
    loop {
        let e = a9.read(addr, 8)?;
        if e[3] == 0xff {
            return Ok(out);
        }
        let (s, dflt) = (
            u16::from_le_bytes([e[4], e[5]]) as i64,
            u16::from_le_bytes([e[6], e[7]]) as i64,
        );
        out.push(
            Json::obj()
                .with("place", e[0])
                .with("item", (e[1] != 0xff).then_some(e[1]))
                .with("person", e[2])
                .with("section", sec(Some(s)))
                .with("default", sec(Some(dflt))),
        );
        addr += 8;
    }
}

fn parse_record(a9: &Arm9, mut addr: u32) -> Result<Json> {
    let (mut prof, mut ev, mut in_ev) = (Vec::new(), Vec::new(), false);
    loop {
        let b = a9.u8(addr)?;
        addr += 1;
        match b {
            0xfe => in_ev = true,
            0xff => return Ok(Json::obj().with("profiles", prof).with("evidence", ev)),
            _ if in_ev => ev.push(b),
            _ => prof.push(b),
        }
    }
}

fn parse_court_present(a9: &Arm9, mut addr: u32) -> Result<Vec<Json>> {
    let mut out = Vec::new();
    loop {
        let b = a9.read(addr, 8)?;
        let h = |k: usize| u16::from_le_bytes([b[k], b[k + 1]]) as i64;
        if h(0) == 0xffff {
            return Ok(out);
        }
        out.push(
            Json::obj()
                .with("at", sec(Some(h(0))))
                .with("item", h(2))
                .with("section", sec(Some(h(4))))
                .with("flag", (b[6] != 0xff).then_some(b[6]))
                .with("b7", b[7]),
        );
        addr += 8;
    }
}

fn hexs(v: Option<i64>) -> String {
    format!("{:#x}", v.unwrap_or(0))
}

/// 記号実行の道を {when: {フラグ: 値}, do: [...]} にする
fn conv_paths(a9: &Arm9, paths: Vec<Way>, exam: &mut Json) -> Result<Vec<Json>> {
    let mut out = Vec::new();
    for (conds, acts) in paths {
        let mut when = Json::obj();
        let mut extra = Vec::new();
        for c in conds {
            match c {
                Cond::Lang(v) => {
                    when.set("lang", v);
                }
                Cond::Flag((g, n), v) => {
                    when.set(format!("{g}:{n:#x}"), v);
                }
                Cond::Other(s, v) => {
                    extra.push(format!("{s} = {}", if v { "True" } else { "False" }))
                }
            }
        }
        let mut dos = Vec::new();
        for Act { name, args } in acts {
            let g = |k: usize| args.get(k).copied().flatten();
            let j = match name.as_str() {
                "fill" if g(1) == Some(EXAMINE_RAM) => Json::obj().with("examine", Json::Null),
                "copy" if g(1) == Some(EXAMINE_RAM) => {
                    let key = hexs(g(0));
                    if exam.get(&key).is_none() {
                        let d = a9.read(g(0).unwrap_or(0) as u32, g(2).unwrap_or(0) as usize)?;
                        exam.set(key.clone(), parse_examine(d)?);
                    }
                    Json::obj().with("examine", key)
                }
                "event" | "event_keep_bgm" => Json::obj()
                    .with(name.clone(), sec(g(0)))
                    .with("set_flag", format!("0:{}", hexs(g(1)))),
                "char" => Json::obj()
                    .with("char", g(0))
                    .with("talk", g(1))
                    .with("idle", g(2)),
                "bgm" | "se" | "op_2232c" | "load_part" => Json::obj().with(name.clone(), g(0)),
                "bg" => Json::obj().with("bg", g(1)),
                "bg_prepare" => continue, // 直後の bg と組
                "bgm_stop" => Json::obj().with("bgm_stop", true),
                "char_raw" => Json::obj()
                    .with("char", g(0))
                    .with("talk", g(2))
                    .with("idle", g(2)),
                "set_flag" => {
                    let a0 = g(0).map_or("None".to_string(), |v| v.to_string());
                    Json::obj()
                        .with("set_flag", format!("{a0}:{}", hexs(g(1))))
                        .with("value", g(2))
                }
                _ => Json::obj()
                    .with("call", name.clone())
                    .with("args", args.clone()),
            };
            dos.push(j);
        }
        if !extra.is_empty() {
            when.set("_other", extra);
        }
        out.push(Json::obj().with("when", when).with("do", dos));
    }
    Ok(out)
}

fn read_bgmap(text: Option<&str>, prefix: &str) -> BTreeMap<i64, Option<String>> {
    let mut out = BTreeMap::new();
    for line in text.unwrap_or("").lines().skip(1) {
        let c: Vec<&str> = line.split('\t').collect();
        if let Ok(k) = c[0].parse::<i64>() {
            let v = (c.len() > 5 && !c[5].is_empty())
                .then(|| format!("{prefix}/data/tail/bg/{}", c[5]));
            out.insert(k, v);
        }
    }
    out
}

mod part;
pub use part::export;
