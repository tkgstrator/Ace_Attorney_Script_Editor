//! data.bin の後半に出てくる個々の形式の画像化（tailfmt.py）。
//!
//! どの関数も、形式が当てはまれば PNG のバイト列を返し、当てはまらなければ None を返す。

use crate::bytes::u32le;
use crate::databin::{tex_bpp, tex_header};
use crate::gfx::{self, Indexed, Layout, Rgb, Rgba};

/// テクスチャ（見出し 20 バイト + 線形の画素 + パレット）。パレットが複数あるときは先頭を使い、色番号 0 は透明
pub fn texture(b: &[u8]) -> Option<Vec<u8>> {
    let t = tex_header(b, 0)?;
    let px = &b[t.px_off..t.px_off + t.px_size];
    let pal = gfx::palette(&b[t.pal_off..t.pal_off + t.pal_size]);
    let bpp = tex_bpp(t.fmt)?;
    let n = t.w * t.h;
    match t.fmt {
        2..=4 => {
            let idx: Vec<u8> = match bpp {
                2 => px
                    .iter()
                    .flat_map(|&a| [a & 3, (a >> 2) & 3, (a >> 4) & 3, (a >> 6) & 3])
                    .collect(),
                4 => gfx::unpack4(px),
                _ => px.to_vec(),
            };
            let img = Indexed {
                w: t.w,
                h: t.h,
                px: idx[..n].to_vec(),
            };
            let cols = 1usize << bpp;
            let mut p: Vec<Rgb> = pal.iter().take(cols).copied().collect();
            if p.is_empty() {
                p = gfx::gray(bpp);
            }
            Some(gfx::png_indexed(&img, &p, true))
        }
        1 | 6 => {
            let (ib, ab) = if t.fmt == 1 { (5, 3) } else { (3, 5) };
            let mut p = pal.clone();
            p.resize(p.len().max(32), [255, 0, 255]);
            p.truncate(32);
            let mut out = Rgba::zeros(t.w, t.h);
            for (i, &a) in px[..n].iter().enumerate() {
                let idx = (a & ((1 << ib) - 1)) as usize;
                let alpha = (a >> ib) as u32 * 255 / ((1 << ab) - 1);
                out.px[i * 4..i * 4 + 3].copy_from_slice(&p[idx]);
                out.px[i * 4 + 3] = alpha as u8;
            }
            Some(gfx::png_rgba(&out))
        }
        7 => {
            let mut out = Rgba::zeros(t.w, t.h);
            for i in 0..n {
                let c = u16::from_le_bytes([px[2 * i], px[2 * i + 1]]) as u32;
                let f = |x: u32| (x * 255 / 31) as u8;
                out.px[i * 4..i * 4 + 4].copy_from_slice(&[
                    f(c & 31),
                    f(c >> 5 & 31),
                    f(c >> 10 & 31),
                    ((c >> 15) * 255) as u8,
                ]);
            }
            Some(gfx::png_rgba(&out))
        }
        _ => None,
    }
}

/// 背景のパック: [パレット（32 = 16 色 / 512 = 256 色）, 横 32 画素ずつの帯 …]
pub fn bg_pack(parts: &[Vec<u8>]) -> Option<Vec<u8>> {
    if parts.len() < 2 || !(parts[0].len() == 32 || parts[0].len() == 512) {
        return None;
    }
    let bpp = if parts[0].len() == 32 { 4 } else { 8 };
    let mut strips = Vec::new();
    for s in &parts[1..] {
        let n = s.len() * 8 / bpp;
        let w = if n == 512 * 32 { 512 } else { 256 };
        if n % (w * 8) != 0 {
            return None;
        }
        strips.push(gfx::decode(s, w, n / w, bpp as u32, Layout::Tiled).ok()?);
    }
    let w = strips.iter().map(|s| s.w).max()?;
    let h: usize = strips.iter().map(|s| s.h).sum();
    let mut img = Indexed::zeros(w, h);
    let mut y0 = 0;
    for s in &strips {
        for y in 0..s.h {
            img.px[(y0 + y) * w..(y0 + y) * w + s.w].copy_from_slice(&s.px[y * s.w..(y + 1) * s.w]);
        }
        y0 += s.h;
    }
    Some(gfx::png_indexed(&img, &gfx::palette(&parts[0]), false))
}

/// 単独の背景: 512 バイトのパレット + 8bpp タイル 256×192、または 32 バイト + 4bpp タイル 256×192
pub fn full_bg(b: &[u8]) -> Option<Vec<u8>> {
    if b.len() == 512 + 256 * 192 {
        let img = gfx::decode(&b[512..], 256, 192, 8, Layout::Tiled).ok()?;
        return Some(gfx::png_indexed(&img, &gfx::palette(&b[..512]), false));
    }
    if b.len() == 32 + 256 * 192 / 2 {
        let img = gfx::decode(&b[32..], 256, 192, 4, Layout::Tiled).ok()?;
        return Some(gfx::png_indexed(&img, &gfx::palette(&b[..32]), false));
    }
    None
}

/// パレットの無い 8bpp の線形 256×192。明るさを引き伸ばした白黒で書く
pub fn gray_bitmap(b: &[u8]) -> Option<Vec<u8>> {
    if b.len() != 256 * 192 {
        return None;
    }
    let top = (*b.iter().max().unwrap_or(&0) as u32).max(1);
    let px = b.iter().map(|&v| (v as u32 * 255 / top) as u8).collect();
    Some(gfx::png_indexed(
        &Indexed { w: 256, h: 192, px },
        &gfx::gray(8),
        false,
    ))
}

/// 法廷記録の説明文（4096 バイト = 4bpp、64×32 の OBJ ブロック 4 個）を 128×64 にする
pub fn profile_text_image(b: &[u8]) -> Option<Indexed> {
    if b.len() != 4096 {
        return None;
    }
    let blocks = gfx::obj_blocks(&gfx::unpack4(b), 256, 32, 64, 32).ok()?;
    let mut out = Indexed::zeros(128, 64);
    for k in 0..4 {
        let (x, y) = (64 * (k / 2), 32 * (k % 2));
        for yy in 0..32 {
            for xx in 0..64 {
                out.px[(y + yy) * 128 + x + xx] = blocks.px[yy * 256 + 64 * k + xx];
            }
        }
    }
    Some(out)
}

pub fn profile_text(b: &[u8]) -> Option<Vec<u8>> {
    Some(gfx::png_indexed(
        &profile_text_image(b)?,
        &gfx::gray(4),
        false,
    ))
}

/// 法廷記録の名前（1024 バイト = 4bpp、32×16 の OBJ ブロック 4 個を横に並べた 128×16）
pub fn name_label_image(b: &[u8]) -> Option<Indexed> {
    if b.len() != 1024 {
        return None;
    }
    gfx::obj_blocks(&gfx::unpack4(b), 128, 16, 32, 16).ok()
}

pub fn name_label(b: &[u8]) -> Option<Vec<u8>> {
    Some(gfx::png_indexed(
        &name_label_image(b)?,
        &gfx::gray(4),
        false,
    ))
}

/// キャラクターのパック: (画像, 動き) の組が並ぶ。画像は u32 (0x80000000 | パレット数) で始まる
pub fn is_char_pack(parts: &[Vec<u8>]) -> bool {
    parts.len() >= 4
        && parts.len().is_multiple_of(2)
        && parts
            .iter()
            .step_by(2)
            .all(|p| p.len() >= 4 && u32le(p, 0) >> 24 == 0x80)
}
