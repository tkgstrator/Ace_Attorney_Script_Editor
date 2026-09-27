//! 台本を命令と文の読める形に書き出す（script_dump.py）。
//!
//! 出力（script/）: NNN.txt（項目ごと）、index.tsv、names.tsv、chars.tsv、bg_map.tsv

use std::collections::{BTreeMap, BTreeSet, HashMap};

use super::{decode, sections, text, Tok};
use crate::bytes::{u32_at, Result};
use crate::sink::Sink;
use crate::statics::op_name;

/// 「区画 + 128」の値を区画の番号として書く
fn sec(v: u16) -> String {
    if v >= 128 {
        format!("§{}", v - 128)
    } else {
        format!("?{v}")
    }
}

/// 命令を読める形にする
pub fn fmt(op: u16, a: &[u16]) -> String {
    let name = op_name(op);
    let g = |k: usize| a.get(k).copied().unwrap_or(0);
    match op {
        14 => format!("[name {}{}]", g(0) >> 8, if g(0) & 0xFF != 0 { "*" } else { "" }),
        30 => {
            let c = g(0);
            if c == 0 {
                return "[char off]".into();
            }
            let pos = if c & 0xC000 == 0 { String::new() } else { format!(" pos{}", c >> 14) };
            format!("[char {}{pos} talk {} idle {}]", c & 0x3FFF, g(1), g(2))
        }
        27 => {
            if g(0) == 0xFFF {
                "[bg off]".into()
            } else {
                format!("[bg {}{}]", g(0) & 0x7FFF, if g(0) & 0x8000 != 0 { " alt" } else { "" })
            }
        }
        8 | 9 => format!("[{name} {}]", a.iter().map(|&x| sec(x)).collect::<Vec<_>>().join(" ")),
        10 | 32 | 44 | 111 => format!("[{name} {}]", sec(g(0))),
        54 | 120 | 122 => format!("[{name} §{}]", g(0)),
        15 => format!("[{name} {} {}]", sec(g(0)), g(1)),
        53 => {
            let (f, want, glob) = (g(0) >> 8, g(0) & 1, g(0) & 0x80);
            let dest = if glob != 0 { format!("§{}", g(1)) } else { format!("+{}B", g(1)) };
            format!("[if flag {f} == {want} → {dest}]")
        }
        16 => format!("[flag {}:{} = {}]", (g(0) >> 8) & 0x7F, g(0) & 0xFF, g(0) >> 15),
        23 | 24 => {
            let kind = if g(0) & 0x8000 != 0 { "profile" } else { "evidence" };
            format!("[{name} {kind} {}{}]", g(0) & 0x3FFF, if g(0) & 0x4000 != 0 { " notice" } else { "" })
        }
        3 => format!("[color {}]", g(0)),
        1 => "\n".into(),
        2 => "[page]\n".into(),
        _ => {
            let mut s = format!("[{name}");
            for x in a {
                s.push_str(&format!(" {x}"));
            }
            s.push(']');
            s
        }
    }
}

/// 名前・人物の数え上げ（script_dump の stats）
#[derive(Default)]
struct Stats {
    /// 名前の番号 → (回数, 台詞の一覧)
    name: BTreeMap<u16, (usize, Vec<String>)>,
    /// 人物の番号 → (動きの番号, 直後の名前の番号 → 回数（入れた順）)
    chr: BTreeMap<u16, (BTreeSet<u16>, Vec<(u16, usize)>)>,
    char_pending: Option<u16>,
}

/// 項目を文字にし、(本文, 最初の日時と場所の表示) を返す
fn dump(entry: &[u16], chars: &HashMap<u16, String>, st: &mut Stats) -> (String, String) {
    let mut lines = String::new();
    let mut caption = String::new();
    for (k, s) in sections(entry).into_iter().enumerate() {
        lines.push_str(&format!("\n== 区画 {k} ==\n"));
        let mut cur_name: Option<u16> = None;
        let mut centered = false;
        for t in decode(s) {
            match t {
                Tok::Text(g) => {
                    let txt = text(&g, chars);
                    lines.push_str(&txt);
                    if centered && caption.is_empty() {
                        caption = txt.clone();
                    }
                    if let Some(n) = cur_name {
                        st.name.entry(n).or_default().1.push(txt);
                    }
                }
                Tok::Op(op, a) => {
                    let a0 = a.first().copied().unwrap_or(0);
                    if op == 14 {
                        cur_name = Some(a0 >> 8);
                        st.name.entry(a0 >> 8).or_default().0 += 1;
                    }
                    if op == 30 && a0 != 0 {
                        let e = st.chr.entry(a0 & 0x3FFF).or_default();
                        e.0.extend(a.get(1..).unwrap_or(&[]).iter().copied());
                        st.char_pending = Some(a0 & 0x3FFF);
                    }
                    if op == 14 && a0 >> 8 != 0 {
                        if let Some(p) = st.char_pending.take() {
                            let names = &mut st.chr.entry(p).or_default().1;
                            match names.iter_mut().find(|(n, _)| *n == a0 >> 8) {
                                Some(e) => e.1 += 1,
                                None => names.push((a0 >> 8, 1)),
                            }
                        }
                    }
                    if op == 93 {
                        centered = a0 == 1;
                    }
                    lines.push_str(&fmt(op, &a));
                }
            }
        }
    }
    (lines, caption.replace('　', " "))
}

/// Python の s[:n]（文字単位）
pub fn head_chars(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

const BG_TABLE: u32 = 0x020a7cb4;
const BG_COUNT: u32 = 241;

/// 台本の背景の番号 → data.bin の位置と、書き出し済みのファイル（bg_pngs = data/tail/bg/ の PNG の名前）
pub fn bg_map(rom: &[u8], bg_pngs: &[String]) -> Result<Vec<String>> {
    let ram = u32_at(rom, 0x28)?;
    let a = crate::nds::arm9(rom)?;
    let files: HashMap<String, &String> = bg_pngs
        .iter()
        .map(|f| (f.trim_end_matches(".png").rsplit('_').next().unwrap_or("").to_string(), f))
        .collect();
    let mut rows = vec!["背景の番号\tdata.bin の位置\t大きさ\tフラグ\t種類\tファイル（data/tail/bg/）".to_string()];
    for k in 0..BG_COUNT {
        let o = (BG_TABLE - ram + 16 * k) as usize;
        let (p, size, flags, kind) = (u32_at(a, o)?, u32_at(a, o + 4)?, u32_at(a, o + 8)?, u32_at(a, o + 12)?);
        let f = files.get(&format!("{p:x}")).map_or("-".to_string(), |s| s.to_string());
        rows.push(format!("{k}\t{p:#x}\t{size}\t{flags:#x}\t{kind:#x}\t{f}"));
    }
    Ok(rows)
}

/// script/ を書き出す（out の根は script）。rom が None なら bg_map.tsv は作らない
pub fn export(entries: &[Vec<u16>], chars: &HashMap<u16, String>, rom: Option<&[u8]>, bg_pngs: &[String], out: &mut dyn Sink) -> Result<()> {
    let mut stats = Stats::default();
    let mut index = vec!["項目\t言語\t区画の数\t最初の日時・場所の表示".to_string()];
    for (i, e) in entries.iter().enumerate() {
        let mut odd = Stats::default();
        let s = if i % 2 == 1 { &mut odd } else { &mut stats };
        let (body, cap) = dump(e, chars, s);
        out.put(&format!("{i:03}.txt"), format!("{}\n", body.trim_start_matches('\n')).into_bytes());
        index.push(format!("{i:03}\t{}\t{}\t{cap}", if i % 2 == 1 { "英" } else { "日" }, sections(e).len()));
    }
    out.put("index.tsv", format!("{}\n", index.join("\n")).into_bytes());
    let mut rows = vec!["名前の番号\t回数\t最初の台詞".to_string()];
    for (k, (n, txts)) in &stats.name {
        let first = txts.iter().find(|t| t.chars().count() > 3).or(txts.first()).map_or("", |s| s.as_str());
        rows.push(format!("{k}\t{n}\t{}", head_chars(first, 30)));
    }
    out.put("names.tsv", format!("{}\n", rows.join("\n")).into_bytes());
    let mut rows = vec!["人物の番号\t動きの番号\t直後の名前の番号（回数）".to_string()];
    for (k, (anims, names)) in &stats.chr {
        let an: Vec<u16> = anims.iter().copied().collect();
        let rng = if an.is_empty() { String::new() } else { format!("{}-{} ({} 個)", an[0], an[an.len() - 1], an.len()) };
        let mut top = names.clone();
        top.sort_by_key(|x| std::cmp::Reverse(x.1)); // 安定な並べ替え = Counter.most_common と同じ
        let top: Vec<String> = top.iter().take(3).map(|(n, m)| format!("{n}({m})")).collect();
        rows.push(format!("{k}\t{rng}\t{}", top.join(" ")));
    }
    out.put("chars.tsv", format!("{}\n", rows.join("\n")).into_bytes());
    if let Some(rom) = rom {
        out.put("bg_map.tsv", format!("{}\n", bg_map(rom, bg_pngs)?.join("\n")).into_bytes());
    }
    out.log(&format!("{} 項目を書き出しました", entries.len()));
    Ok(())
}
