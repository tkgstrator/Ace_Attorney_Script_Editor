//! 台本（mes_all.bin）の読み出し（script.py・script_dump.py の前半）。
//!
//! mes_all.bin = u32 項目の数 + (u32 位置, u32 大きさ) × 項目の数。各項目は LZ77（0x10）で圧縮。
//! 項目を展開すると u32 区画の数 N + u32 区画の位置 × N + 区画の中身（u16 の並び。128 以上 = 文字、未満 = 命令）。

pub mod dump;
pub mod json;

use std::collections::HashMap;

use crate::bytes::{u32_at, words16, Result};
use crate::charset::{layout_chars, CODE_BASE};
use crate::nitro::decompress;
use crate::statics::argc;

/// 各項目を展開したバイト列
pub fn items(mes: &[u8]) -> Result<Vec<Vec<u8>>> {
    let n = u32_at(mes, 0)? as usize;
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let off = u32_at(mes, 4 + i * 8)? as usize;
        out.push(decompress(mes, off)?.0);
    }
    Ok(out)
}

/// 各項目を展開して u16 の並びにする
pub fn entries(mes: &[u8]) -> Result<Vec<Vec<u16>>> {
    Ok(items(mes)?.iter().map(|d| words16(d)).collect())
}

/// Python の e[a:b]
fn sl(e: &[u16], a: usize, b: usize) -> &[u16] {
    let b = b.min(e.len());
    &e[a.min(b)..b]
}

/// 項目を区画に分ける（区画の位置はバイト単位。見出しの末尾のラベルも空の区画として数える）
pub fn sections(e: &[u16]) -> Vec<&[u16]> {
    let n = e[0] as usize | (e[1] as usize) << 16;
    let mut offs: Vec<usize> =
        (0..n).map(|i| (e[2 + 2 * i] as usize | (e[3 + 2 * i] as usize) << 16) / 2).collect();
    offs.push(e.len());
    (0..n).map(|i| sl(e, offs[i], offs[i + 1])).collect()
}

/// 区画の中の 1 つ: 文（フォントの番号の並び）か命令
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Tok {
    Text(Vec<u16>),
    Op(u16, Vec<u16>),
}

impl Tok {
    pub fn op(&self) -> Option<u16> {
        match self {
            Tok::Op(o, _) => Some(*o),
            Tok::Text(_) => None,
        }
    }
    /// 命令の第 k 引数（無ければ None）
    pub fn arg(&self, k: usize) -> Option<u16> {
        match self {
            Tok::Op(_, a) => a.get(k).copied(),
            Tok::Text(_) => None,
        }
    }
}

/// 区画を文と命令の並びにする
pub fn decode(s: &[u16]) -> Vec<Tok> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < s.len() {
        let w = s[i];
        if w >= CODE_BASE {
            let mut j = i;
            while j < s.len() && s[j] >= CODE_BASE {
                j += 1;
            }
            out.push(Tok::Text(s[i..j].iter().map(|x| x - CODE_BASE).collect()));
            i = j;
            continue;
        }
        let n = argc(w);
        out.push(Tok::Op(w, sl(s, i + 1, i + 1 + n).to_vec()));
        i += 1 + n;
    }
    out
}

/// フォントの番号 → 文字（LAYOUT、OCR の結果 mapping.tsv、手で直した font_fixes.tsv の順に上書き）
pub fn load_chars(mapping: &[(i64, String)], fixes: &[(i64, String)]) -> HashMap<u16, String> {
    let lay = layout_chars();
    let mut out: HashMap<u16, String> = lay.iter().enumerate().map(|(i, c)| (i as u16, c.to_string())).collect();
    for (k, v) in mapping {
        if *k >= lay.len() as i64 && !v.is_empty() {
            out.insert(*k as u16, v.clone());
        }
    }
    for (k, v) in fixes {
        if !v.is_empty() {
            out.insert(*k as u16, v.clone());
        }
    }
    out
}

/// 番号の並びを文字にする（分からない番号は {番号}）
pub fn text(glyphs: &[u16], chars: &HashMap<u16, String>) -> String {
    let mut s = String::new();
    for g in glyphs {
        match chars.get(g) {
            Some(c) => s.push_str(c),
            None => s.push_str(&format!("{{{g}}}")),
        }
    }
    s
}
