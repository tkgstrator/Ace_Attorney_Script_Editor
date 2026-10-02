//! 台本の項目を変換（tools/convert/）で読むための JSON にする（script_json.py・script_choices.py）。
//!
//! 出力: script/json/NNN.json。選択肢の文（ボタンの絵の文字認識）は開発のときだけのものなので行わない（text は null）。

use std::collections::HashMap;

use crate::bytes::Result;
use crate::charset::CODE_BASE;
use crate::json::Json;
use crate::nds::Arm9;
use crate::statics::{self, argc};

/// 引数が「区画 + 128」の命令と、その引数の位置
fn section_args(op: u16) -> Option<&'static [usize]> {
    Some(match op {
        8 => &[0, 1],
        9 => &[0, 1, 2],
        10 | 15 | 32 | 44 | 111 => &[0],
        42 => &[1, 2],
        _ => return None,
    })
}

/// 命令の名前（tables/opcodes.json と同じもの）
fn op_name(op: u16) -> String {
    statics::get("opcodes")
        .get(&op.to_string())
        .and_then(|o| o.get("name"))
        .and_then(Json::as_str)
        .map_or_else(|| statics::op_name(op), String::from)
}

/// 区画とラベルに分ける（tbl_script.py の split_header と同じ判定）
fn split_labels(e: &[u16]) -> Result<(Vec<&[u16]>, Json)> {
    let n = e[0] as usize | (e[1] as usize) << 16;
    let heads: Vec<usize> = (0..n)
        .map(|i| e[2 + 2 * i] as usize | (e[3 + 2 * i] as usize) << 16)
        .collect();
    let size = e.len() * 2;
    let mut k = 0;
    while k < n && heads[k] < size && (k == 0 || heads[k] > heads[k - 1]) && e[heads[k] / 2] == 0 {
        k += 1;
    }
    let mut offs: Vec<usize> = heads[..k].iter().map(|h| h / 2).collect();
    offs.push(e.len());
    let secs = (0..k).map(|i| &e[offs[i]..offs[i + 1]]).collect();
    let mut labels = Json::obj();
    for (i, &h) in heads.iter().enumerate().skip(k) {
        if h >> 16 >= k {
            return crate::bytes::err("ラベルの区画が範囲外");
        }
        labels.set(
            i.to_string(),
            Json::obj()
                .with("section", h >> 16)
                .with("offset", h & 0xFFFE),
        );
    }
    Ok((secs, labels))
}

fn decode_section(s: &[u16], chars: &HashMap<u16, String>, labels: &Json) -> Vec<Json> {
    let mut out = Vec::new();
    let mut i = 0;
    let label = |v: u16| labels.get(&v.to_string()).cloned().unwrap_or(Json::Null);
    while i < s.len() {
        let w = s[i];
        if w >= CODE_BASE {
            let mut j = i;
            while j < s.len() && s[j] >= CODE_BASE {
                j += 1;
            }
            let txt = crate::script::text(
                &s[i..j].iter().map(|g| g - CODE_BASE).collect::<Vec<_>>(),
                chars,
            );
            out.push(
                Json::obj()
                    .with("at", i * 2)
                    .with("op", "text")
                    .with("text", txt),
            );
            i = j;
            continue;
        }
        let n = argc(w);
        let args: Vec<u16> = s[(i + 1).min(s.len())..(i + 1 + n).min(s.len())].to_vec();
        let g = |k: usize| args.get(k).copied().unwrap_or(0);
        let mut o = Json::obj()
            .with("at", i * 2)
            .with("op", w)
            .with("name", op_name(w))
            .with("args", args.clone());
        if let Some(ks) = section_args(w) {
            let t: Vec<Json> = ks
                .iter()
                .map(|&k| {
                    if g(k) >= 128 {
                        Json::obj().with("section", g(k) - 128).with("offset", 0)
                    } else {
                        Json::Null
                    }
                })
                .collect();
            o.set("targets", t);
        }
        if matches!(w, 54 | 120 | 122) {
            o.set("target", label(g(0)));
        }
        if w == 53 {
            let t = if g(0) & 0x80 != 0 {
                label(g(1))
            } else {
                Json::obj()
                    .with("section", Json::Null)
                    .with("offset", g(1) & !1)
            };
            o.set("target", t);
        }
        out.push(o);
        i += 1 + n;
    }
    out
}

const ROWS: u32 = 200;
const ROW_TABLE: u32 = 0x020b4b74;

/// その話の選択肢: 区画 → {row, layout, textures, png, text}
fn choices_for(
    a9: &Arm9,
    part: usize,
    lang: &str,
    sections: &[usize],
    prefix: &str,
) -> Result<Json> {
    let (tex_table, pack) = if lang == "ja" {
        (0x020b5024u32, "25cf5e4")
    } else {
        (0x020b54d4, "263bf4c")
    };
    let mut picked: std::collections::BTreeMap<i64, (u32, u8, Vec<u16>)> = Default::default();
    for r in 0..ROWS {
        let a = ROW_TABLE + r * 6;
        let (p, sec, layout) = (a9.u8(a)?, a9.u16(a + 2)? as i64 - 128, a9.u8(a + 4)?);
        let tex: Vec<u16> = (0..3)
            .map(|k| a9.u16(tex_table + r * 6 + k * 2))
            .collect::<Result<Vec<_>>>()?
            .into_iter()
            .filter(|&t| t != 0xFFFF)
            .collect();
        if p as usize == part && sec >= 0 && sections.contains(&(sec as usize)) {
            picked.insert(sec, (r, layout, tex)); // 同じ区画の行は後の行で上書き（Python の dict と同じ）
        }
    }
    let mut out = Json::obj();
    for (s, (row, layout, tex)) in picked {
        let png: Vec<String> = tex
            .iter()
            .map(|t| format!("{prefix}/data/tail/packs/{pack}/{t:04}.png"))
            .collect();
        out.set(
            s.to_string(),
            Json::obj()
                .with("row", row)
                .with("layout", layout)
                .with("textures", tex.clone())
                .with("png", png)
                .with("text", vec![Json::Null; tex.len()]),
        );
    }
    Ok(out)
}

/// 1 項目の JSON（a9 があれば choices も）
pub fn export(
    entry: &[u16],
    idx: usize,
    chars: &HashMap<u16, String>,
    a9: Option<&Arm9>,
    prefix: &str,
) -> Result<String> {
    let (secs, labels) = split_labels(entry)?;
    let body: Vec<Json> = secs
        .iter()
        .enumerate()
        .map(|(k, s)| {
            Json::obj()
                .with("section", k)
                .with("ops", decode_section(s, chars, &labels))
        })
        .collect();
    let lang = if idx % 2 == 1 { "en" } else { "ja" };
    let mut with_choice: Vec<usize> = Vec::new();
    for (k, s) in secs.iter().enumerate() {
        if crate::script::decode(s)
            .iter()
            .any(|t| matches!(t.op(), Some(8 | 9)))
        {
            with_choice.push(k);
        }
    }
    let mut out = Json::obj()
        .with("entry", idx)
        .with("lang", lang)
        .with("sections", secs.len())
        .with("labels", labels)
        .with("body", body);
    if let Some(a9) = a9 {
        let c = if with_choice.is_empty() {
            Json::obj()
        } else {
            choices_for(a9, idx / 2, lang, &with_choice, prefix)?
        };
        out.set("choices", c);
    }
    Ok(out.dumps() + "\n")
}
