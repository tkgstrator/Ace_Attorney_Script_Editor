//! キャラクターのアニメーション（OAM スプライト）の書き出し（ex_chars.py）。
//!
//! 画像（gfx）: u32 0x80000000 | パレット数 n、パレット 32 バイト × n、u32 の位置の表（最初の値 / 4 が部品の数）、
//!   部品ごとの独自の RLE（u16 の制御語。最上位ビットが 1 なら次の u16 を下位 15 ビット回、0 ならそのまま写す）。
//! 動き（anim）: u16 0, u16 コマ送りの数 m, m × (u16 コマの位置, u16 長さ, u32 0)。
//!   コマ: u16 部品の数 k, u16 0, k × (s8 x, s8 y, u8 部品番号, u8 属性)。
//!   属性の上位 4 ビットは OAM の形と大きさ、下位 4 ビット × n / 16 がパレットの番号。

use std::collections::BTreeMap;

use crate::bytes::{err, py_slice, u16_at, u32_at, Result};
use crate::gfx::{self, Rgb, Rgba};
use crate::sink::Sink;

/// OAM の (大きさ << 2) | 形 → (幅, 高さ)
pub fn oam_size(k: u8) -> Option<(usize, usize)> {
    Some(match k {
        0 => (8, 8),
        1 => (16, 8),
        2 => (8, 16),
        4 => (16, 16),
        5 => (32, 8),
        6 => (8, 32),
        8 => (32, 32),
        9 => (32, 16),
        10 => (16, 32),
        12 => (64, 64),
        13 => (64, 32),
        14 => (32, 64),
        _ => return None,
    })
}

pub fn unrle16(c: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut q = 0usize;
    while q + 2 <= c.len() {
        let ctl = u16::from_le_bytes([c[q], c[q + 1]]);
        q += 2;
        let n = (ctl & 0x7FFF) as usize;
        if ctl & 0x8000 != 0 {
            let s = py_slice(c, q, q + 2);
            for _ in 0..n {
                out.extend_from_slice(s);
            }
            q += 2;
        } else {
            out.extend_from_slice(py_slice(c, q, q + 2 * n));
            q += 2 * n;
        }
    }
    out
}

/// (パレットの一覧, 部品の 4bpp データの一覧)
pub fn parse_gfx(b: &[u8]) -> Result<(Vec<Vec<Rgb>>, Vec<Vec<u8>>)> {
    let npal = (u32_at(b, 0)? & 0xFF) as usize;
    let pals = (0..npal).map(|i| gfx::palette(py_slice(b, 4 + 32 * i, 36 + 32 * i))).collect();
    let q = 4 + 32 * npal;
    let n = (u32_at(b, q)? / 4) as usize;
    let mut offs = Vec::with_capacity(n + 1);
    for i in 0..n {
        offs.push(u32_at(b, q + 4 * i)? as i64);
    }
    offs.push(b.len() as i64 - q as i64);
    let cells = (0..n)
        .map(|i| {
            let a = (q as i64 + offs[i]).max(0) as usize;
            let e = (q as i64 + offs[i + 1]).max(0) as usize;
            unrle16(py_slice(b, a, e))
        })
        .collect();
    Ok((pals, cells))
}

/// コマの部品 (x, y, 部品番号, 属性)
pub type Piece = (i8, i8, u8, u8);

/// コマの位置の部品を読む（範囲に収まるものだけ）
pub fn read_frame(b: &[u8], off: usize) -> Result<Vec<Piece>> {
    let k = u16_at(b, off)? as usize;
    Ok((0..k)
        .filter(|j| off + 8 + 4 * j <= b.len())
        .map(|j| {
            let p = off + 4 + 4 * j;
            (b[p] as i8, b[p + 1] as i8, b[p + 2], b[p + 3])
        })
        .collect())
}

/// (コマ送りの一覧 [(コマの位置, 長さ)], コマの位置 → 部品の一覧（初めて出た順）)
pub fn parse_anim(b: &[u8]) -> Result<(Vec<(u16, u16)>, Vec<(usize, Vec<Piece>)>)> {
    let m = u16_at(b, 2)? as usize;
    let mut seq = Vec::with_capacity(m);
    for i in 0..m {
        seq.push((u16_at(b, 8 + 8 * i)?, u16_at(b, 10 + 8 * i)?));
    }
    let mut frames: Vec<(usize, Vec<Piece>)> = Vec::new();
    for &(off, _) in &seq {
        let off = off as usize;
        if frames.iter().any(|(o, _)| *o == off) || off + 4 > b.len() {
            continue;
        }
        frames.push((off, read_frame(b, off)?));
    }
    Ok((seq, frames))
}

fn pieces(pals: &[Vec<Rgb>], cells: &[Vec<u8>], frame: &[Piece]) -> Result<Vec<(i32, i32, Rgba)>> {
    let mut out = Vec::new();
    for &(x, y, i, attr) in frame {
        let Some((w, h)) = oam_size(attr >> 4) else { continue };
        let i = i as usize;
        if i >= cells.len() || cells[i].len() * 2 < w * h {
            continue;
        }
        let idx = gfx::tiled(&gfx::unpack4(&cells[i]), w, h)?;
        if pals.is_empty() {
            return err("パレットがありません");
        }
        let pi = ((attr & 15) as usize * pals.len() / 16).min(pals.len() - 1);
        let pal = &pals[pi];
        if pal.len() < 16 && idx.px.iter().any(|&c| c as usize >= pal.len()) {
            return err("パレットの色が足りません");
        }
        out.push((x as i32, y as i32, gfx::to_rgba(&idx, pal)));
    }
    Ok(out)
}

/// 全部のコマを同じ大きさ（全コマを囲む四角）で描き、(コマの位置 → RGBA, 原点) を返す
pub fn render(pals: &[Vec<Rgb>], cells: &[Vec<u8>], frames: &[(usize, Vec<Piece>)]) -> Result<(BTreeMap<usize, Rgba>, (i32, i32))> {
    let mut all = Vec::with_capacity(frames.len());
    for (off, f) in frames {
        all.push((*off, pieces(pals, cells, f)?));
    }
    let flat: Vec<&(i32, i32, Rgba)> = all.iter().flat_map(|(_, ps)| ps.iter()).collect();
    if flat.is_empty() {
        return Ok((BTreeMap::new(), (0, 0)));
    }
    let x0 = flat.iter().map(|p| p.0).min().unwrap();
    let y0 = flat.iter().map(|p| p.1).min().unwrap();
    let x1 = flat.iter().map(|p| p.0 + p.2.w as i32).max().unwrap();
    let y1 = flat.iter().map(|p| p.1 + p.2.h as i32).max().unwrap();
    let (cw, ch) = ((x1 - x0) as usize, (y1 - y0) as usize);
    let mut out = BTreeMap::new();
    for (off, ps) in &all {
        let mut can = Rgba::zeros(cw, ch);
        for (x, y, img) in ps.iter().rev() {
            // 先に書かれた部品ほど手前
            let (ox, oy) = ((x - x0) as usize, (y - y0) as usize);
            for yy in 0..img.h {
                for xx in 0..img.w {
                    let s = (yy * img.w + xx) * 4;
                    if img.px[s + 3] != 0 {
                        let t = ((oy + yy) * cw + ox + xx) * 4;
                        can.px[t..t + 4].copy_from_slice(&img.px[s..s + 4]);
                    }
                }
            }
        }
        out.insert(*off, can);
    }
    Ok((out, (-x0, -y0)))
}

/// Python のタプル (a, b) の表記
pub fn py_tuple2(t: (i32, i32)) -> String {
    format!("({}, {})", t.0, t.1)
}

/// キャラクターのパックを dst/NNN/ に書き出す（fNN.png, anim.tsv, anim.gif）
pub fn export_pack(parts: &[Vec<u8>], dst: &str, out: &mut dyn Sink) {
    let mut k = 0;
    while k + 1 < parts.len() {
        let d = format!("{dst}/{:03}", k / 2);
        let r = (|| -> Result<_> {
            let (pals, cells) = parse_gfx(&parts[k])?;
            let (seq, frames) = parse_anim(&parts[k + 1])?;
            let (imgs, origin) = render(&pals, &cells, &frames)?;
            Ok((seq, imgs, origin))
        })();
        match r {
            Err(e) => out.put(&format!("{d}/error.txt"), format!("読み取れませんでした: {e}\n").into_bytes()),
            Ok((seq, imgs, origin)) => {
                let mut names = BTreeMap::new();
                for (n, (off, img)) in imgs.iter().enumerate() {
                    let name = format!("f{n:02}.png");
                    out.put(&format!("{d}/{name}"), gfx::png_rgba(img));
                    names.insert(*off, name);
                }
                let rows: Vec<String> = seq
                    .iter()
                    .map(|&(o, t)| format!("{}\t{t}", names.get(&(o as usize)).map_or("-", |s| s.as_str())))
                    .collect();
                let tsv = format!(
                    "# 原点（キャラクターの基準点）: 画像の {}\nコマ\t長さ（1/60 秒）\n{}\n",
                    py_tuple2(origin),
                    rows.join("\n")
                );
                out.put(&format!("{d}/anim.tsv"), tsv.into_bytes());
                if names.len() > 1 {
                    let frames: Vec<(&gfx::Rgba, u16)> = seq
                        .iter()
                        .filter_map(|&(o, t)| imgs.get(&(o as usize)).map(|img| (img, gfx::gif_delay(t as u32))))
                        .collect();
                    out.put(&format!("{d}/anim.gif"), gfx::gif_anim(&frames));
                }
            }
        }
        k += 2;
    }
}
