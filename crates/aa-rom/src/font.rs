//! 本文のフォント（dsfont.py）と、ゲームで使うドットフォントの組み立て（build_font.py）。
//!
//! 字形: 1 文字 = 16×16 ドット、4 ビット、8×8 のタイル 4 枚（左上・右上・左下・右下）= 128 バイト。点は値 3。
//! 文字の対応（番号 → 文字）は開発のときに OCR で作ったもの（mapping.tsv など）を引数で受け取る。

use std::collections::HashMap;

use unicode_normalization::UnicodeNormalization;

use crate::bytes::{err, Result};
use crate::gfx;

const CELL: usize = 16;
const GLYPH_BYTES: usize = 128;
const TILES: [(usize, usize); 4] = [(0, 0), (1, 0), (0, 1), (1, 1)];
const COLUMNS: usize = 64;

/// 1 文字の 16 行（'@' が点、'.' が空き）
pub type Glyph = Vec<String>;

fn decode(rom: &[u8], base: usize) -> [[u8; CELL]; CELL] {
    let mut cell = [[0u8; CELL]; CELL];
    for (t, &(tx, ty)) in TILES.iter().enumerate() {
        for y in 0..8 {
            for x in 0..8 {
                let b = rom[base + t * 32 + y * 4 + x / 2];
                cell[ty * 8 + y][tx * 8 + x] = if x % 2 == 1 { b >> 4 } else { b & 0xF };
            }
        }
    }
    cell
}

/// (先頭, 文字数)。0 と 3 だけが 1,000 文字ぶん以上続く所から、文字の区切りを決める
pub fn find_font(rom: &[u8]) -> Result<(usize, usize)> {
    let ok = |b: u8| matches!(b, 0x00 | 0x03 | 0x30 | 0x33);
    let (mut best, mut i) = (None::<(usize, usize)>, 0);
    while i < rom.len() {
        if !ok(rom[i]) {
            i += 1;
            continue;
        }
        let s = i;
        while i < rom.len() && ok(rom[i]) {
            i += 1;
        }
        if i - s >= GLYPH_BYTES * 1000 && best.is_none_or(|(a, b)| i - s > b - a) {
            best = Some((s, i));
        }
    }
    let Some((rs, re)) = best else { return err("フォントらしい所が見つかりません") };
    // 区切りの位置: 一番上の行と下の 2 行に点がないマスがいちばん多くなる位置を選ぶ
    let blank_margins = |offset: usize| -> usize {
        let mut n = 0;
        let mut base = rs + offset;
        while base < re - GLYPH_BYTES {
            let c = decode(rom, base);
            let empty = |r: &[u8; CELL]| r.iter().all(|&v| v == 0);
            n += (empty(&c[0]) && empty(&c[14]) && empty(&c[15])) as usize;
            base += GLYPH_BYTES * 7;
        }
        n
    };
    let mut offset = 0;
    let mut best_n = None;
    for o in (0..GLYPH_BYTES).step_by(4) {
        let n = blank_margins(o);
        if best_n.is_none_or(|b| n > b) {
            best_n = Some(n);
            offset = o;
        }
    }
    let mut start = rs + offset;
    let mut count = (re - start) / GLYPH_BYTES;
    let zero = |a: usize| rom[a..a + GLYPH_BYTES].iter().all(|&v| v == 0);
    while count > 0 && zero(start) {
        start += GLYPH_BYTES;
        count -= 1;
    }
    while count > 0 && zero(start + (count - 1) * GLYPH_BYTES) {
        count -= 1;
    }
    Ok((start, count))
}

/// 全文字の字形
pub fn extract(rom: &[u8]) -> Result<Vec<Glyph>> {
    let (start, count) = find_font(rom)?;
    Ok((0..count)
        .map(|i| {
            decode(rom, start + i * GLYPH_BYTES)
                .iter()
                .map(|row| row.iter().map(|&v| if v != 0 { '@' } else { '.' }).collect())
                .collect()
        })
        .collect())
}

/// glyphs.txt の中身
pub fn glyphs_txt(glyphs: &[Glyph]) -> String {
    let mut s = String::new();
    for (i, g) in glyphs.iter().enumerate() {
        s.push_str(&format!("# {i}\n{}\n", g.join("\n")));
    }
    s
}

/// 全文字を並べた確認用の画像（32 列、1 文字 18×18、白い点、マスの間は灰色）
pub fn sheet_png(glyphs: &[Glyph]) -> Vec<u8> {
    let (cols, pad) = (32, CELL + 2);
    let (w, h) = (cols * pad, glyphs.len().div_ceil(cols) * pad);
    let mut img = vec![48u8; w * h];
    for (i, g) in glyphs.iter().enumerate() {
        let (ox, oy) = ((i % cols) * pad + 1, (i / cols) * pad + 1);
        for (y, row) in g.iter().enumerate() {
            for (x, c) in row.chars().enumerate() {
                img[(oy + y) * w + ox + x] = if c == '@' { 255 } else { 0 };
            }
        }
    }
    gfx::png_gray(w, h, &img)
}

/// glyphs.txt を読む（read_glyphs）
pub fn read_glyphs(text: &str) -> Vec<Glyph> {
    text.split("# ").skip(1).map(|b| b.split('\n').skip(1).take(16).map(String::from).collect()).collect()
}

/// 番号 TAB 文字 の表（read_tsv）。入れた順を保つ
pub fn read_tsv(text: &str) -> Vec<(i64, String)> {
    let mut out: Vec<(i64, String)> = Vec::new();
    for line in text.lines() {
        if line.starts_with('#') || line.trim().is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split('\t').collect();
        let Ok(k) = parts[0].trim().parse::<i64>() else { continue };
        let v = parts.get(1).copied().unwrap_or("").to_string();
        tsv_set(&mut out, k, v);
    }
    out
}

/// dict の d[k] = v（あれば位置を変えずに置き換える）
pub fn tsv_set(m: &mut Vec<(i64, String)>, k: i64, v: String) {
    match m.iter_mut().find(|(kk, _)| *kk == k) {
        Some(e) => e.1 = v,
        None => m.push((k, v)),
    }
}

/// font_extra.txt（「# 文字<TAB>説明」と 16 行の点）
pub fn read_extra(text: &str) -> Vec<(char, Glyph)> {
    let lines: Vec<&str> = text.split('\n').collect();
    let mut out: Vec<(char, Glyph)> = Vec::new();
    for (i, line) in lines.iter().enumerate() {
        let head = line.strip_prefix("# ").map(|h| h.split('\t').next().unwrap_or("")).unwrap_or("");
        let mut cs = head.chars();
        if let (Some(c), None) = (cs.next(), cs.next()) {
            let rows = lines[i + 1..(i + 1 + CELL).min(lines.len())]
                .iter()
                .map(|r| {
                    let mut s: String = r.chars().take(CELL).collect();
                    while s.chars().count() < CELL {
                        s.push('.');
                    }
                    s
                })
                .collect();
            match out.iter_mut().find(|(k, _)| *k == c) {
                Some(e) => e.1 = rows,
                None => out.push((c, rows)),
            }
        }
    }
    out
}

fn top(g: &Glyph) -> Option<i64> {
    g.iter().position(|r| r.contains('@')).map(|y| y as i64)
}

fn single(s: &str) -> Option<char> {
    let mut it = s.chars();
    match (it.next(), it.next()) {
        (Some(c), None) => Some(c),
        _ => None,
    }
}

/// ほかの作品のフォント（字形・対応・手で直した対応）
pub struct OtherFont {
    pub glyphs: Vec<Glyph>,
    pub mapping: Vec<(i64, String)>,
}

/// ほかの作品のフォントから、base にない字の字形を取り出す（上下のずれは近い番号の目印から直す）
fn other_game(o: &OtherFont, base: &HashMap<char, Glyph>) -> Vec<(char, Glyph)> {
    let mut shift: Vec<(i64, i64)> = Vec::new();
    for (i, ch) in &o.mapping {
        let Some(c) = single(ch).filter(|c| base.contains_key(c)) else { continue };
        let Some(g) = o.glyphs.get(*i as usize) else { continue };
        if let (Some(a), Some(b)) = (top(g), top(&base[&c])) {
            match shift.iter_mut().find(|(k, _)| k == i) {
                Some(e) => e.1 = b - a,
                None => shift.push((*i, b - a)),
            }
        }
    }
    let mut sorted = o.mapping.clone();
    sorted.sort_by_key(|(i, _)| *i);
    let mut out: Vec<(char, Glyph)> = Vec::new();
    for (i, ch) in &sorted {
        let Some(c) = single(ch) else { continue };
        if base.contains_key(&c) || out.iter().any(|(k, _)| *k == c) || shift.is_empty() {
            continue;
        }
        let near = shift.iter().min_by_key(|(k, _)| (k - i).abs()).unwrap();
        let dy = if matches!(near.1.abs(), 0 | 4) { near.1 } else { 0 };
        let g = &o.glyphs[*i as usize];
        let blank = ".".repeat(CELL);
        let rows: Glyph = if dy >= 0 {
            let dy = dy as usize;
            std::iter::repeat_n(blank, dy).chain(g.iter().take(CELL.saturating_sub(dy)).cloned()).collect()
        } else {
            let dy = (-dy) as usize;
            g.iter().skip(dy).cloned().chain(std::iter::repeat_n(blank, dy)).collect()
        };
        out.push((c, rows));
    }
    out
}

/// build_font の結果: (ds-font.png, ds-font.json)
pub fn build(
    glyphs: &[Glyph],
    mapping: &[(i64, String)],
    fixes: &[(i64, String)],
    also: &[OtherFont],
    extra: &[(char, Glyph)],
) -> (Vec<u8>, String) {
    use crate::charset::{ALIASES, KANJI_START};
    let mut m = mapping.to_vec();
    for (k, v) in fixes {
        tsv_set(&mut m, *k, v.clone());
    }
    // 漢字の終わり（空の番号）より後ろは、同じ字を上に寄せた 2 組目なので使わない
    let end = m.iter().filter(|(i, c)| *i >= KANJI_START as i64 && c.is_empty()).map(|(i, _)| *i).min().unwrap_or(glyphs.len() as i64);
    let mut sorted = m.clone();
    sorted.sort_by_key(|(i, _)| *i);
    let mut index: Vec<(char, i64)> = Vec::new();
    let mut has: HashMap<char, i64> = HashMap::new();
    let mut setdefault = |c: char, i: i64, index: &mut Vec<(char, i64)>| {
        if let std::collections::hash_map::Entry::Vacant(e) = has.entry(c) {
            e.insert(i);
            index.push((c, i));
        }
    };
    for (i, ch) in &sorted {
        let Some(c) = single(ch).filter(|_| *i < end) else { continue };
        setdefault(c, *i, &mut index);
        // 半角の英数字・記号は全角でも引けるようにする（逆も）
        let wide: String = c.to_string().nfkc().collect();
        if let Some(wc) = single(&wide) {
            setdefault(wc, *i, &mut index);
        }
        if (0x21..=0x7E).contains(&(c as u32)) {
            setdefault(char::from_u32(c as u32 + 0xFEE0).unwrap(), *i, &mut index);
        }
    }
    for (alias, target) in ALIASES {
        if let Some(&(_, i)) = index.iter().find(|(c, _)| c == target) {
            setdefault(*alias, i, &mut index);
        }
    }
    let mut shapes: HashMap<char, Glyph> = index.iter().map(|&(c, i)| (c, glyphs[i as usize].clone())).collect();
    for o in also {
        for (c, g) in other_game(o, &shapes) {
            shapes.insert(c, g);
        }
    }
    for (c, g) in extra {
        shapes.entry(*c).or_insert_with(|| g.clone());
    }
    let mut chars: Vec<char> = shapes.keys().copied().collect();
    chars.sort();
    let rows = chars.len().div_ceil(COLUMNS);
    let (w, h) = (COLUMNS * CELL, rows * CELL);
    let mut img = vec![0u8; w * h];
    for (k, c) in chars.iter().enumerate() {
        let (ox, oy) = ((k % COLUMNS) * CELL, (k / COLUMNS) * CELL);
        for (y, row) in shapes[c].iter().enumerate() {
            for (x, ch) in row.chars().enumerate() {
                if ch == '@' {
                    img[(oy + y) * w + ox + x] = 255;
                }
            }
        }
    }
    let s: String = chars.iter().collect();
    let json = format!("{{\"size\": {CELL}, \"columns\": {COLUMNS}, \"chars\": {}}}\n", crate::json::Json::Str(s).dumps());
    (gfx::png_gray(w, h, &img), json)
}
