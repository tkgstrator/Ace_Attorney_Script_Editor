//! DS のグラフィック形式の展開と PNG の書き出し（gfx.py）。
//!
//! - 色: BGR555（1 色 2 バイト、ビット 0-4 = 赤、5-9 = 緑、10-14 = 青）
//! - 4bpp: 1 バイトに 2 画素。下位 4 ビットが左の画素
//! - タイル: 8×8 画素。「タイル並び」はタイルを左上から横方向に並べる。「線形」は 1 行ずつ
//!
//! 一覧画像（_sheet.png、ImageMagick の montage）は作らない。

use crate::bytes::{err, Result};

pub type Rgb = [u8; 3];

/// 色番号の 2 次元配列（h 行 × w 列）
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Indexed {
    pub w: usize,
    pub h: usize,
    pub px: Vec<u8>,
}

/// RGBA の画像
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rgba {
    pub w: usize,
    pub h: usize,
    pub px: Vec<u8>,
}

impl Indexed {
    pub fn zeros(w: usize, h: usize) -> Self {
        Indexed { w, h, px: vec![0; w * h] }
    }
    pub fn at(&self, x: usize, y: usize) -> u8 {
        self.px[y * self.w + x]
    }
    pub fn any(&self) -> bool {
        self.px.iter().any(|&v| v != 0)
    }
}

impl Rgba {
    pub fn zeros(w: usize, h: usize) -> Self {
        Rgba { w, h, px: vec![0; w * h * 4] }
    }
}

/// BGR555 のパレットを (R, G, B) の一覧にする
pub fn palette(b: &[u8]) -> Vec<Rgb> {
    b.as_chunks::<2>().0.iter()
        .map(|c| {
            let v = u16::from_le_bytes([c[0], c[1]]) as u32;
            let f = |x: u32| (x * 255 / 31) as u8;
            [f(v & 31), f((v >> 5) & 31), f((v >> 10) & 31)]
        })
        .collect()
}

/// パレットが分からないときの白黒の仮パレット
pub fn gray(bits: u32) -> Vec<Rgb> {
    let n = 1u32 << bits;
    (0..n).map(|i| [(i * 255 / (n - 1)) as u8; 3]).collect()
}

/// 4bpp のバイト列を 1 画素 1 バイトにする
pub fn unpack4(b: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(b.len() * 2);
    for &x in b {
        out.push(x & 15);
        out.push(x >> 4);
    }
    out
}

/// 1bpp（下位ビットが左）を 1 画素 1 バイトにする
pub fn unpack1(b: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(b.len() * 8);
    for &x in b {
        for i in 0..8 {
            out.push((x >> i) & 1);
        }
    }
    out
}

/// 8×8 タイルを横方向に並べた画素列を h×w にする
pub fn tiled(px: &[u8], w: usize, h: usize) -> Result<Indexed> {
    if px.len() < w * h || !w.is_multiple_of(8) || !h.is_multiple_of(8) {
        return err(format!("タイルの大きさが合いません: {} < {}×{}", px.len(), w, h));
    }
    let mut out = Indexed::zeros(w, h);
    let tw = w / 8;
    for ty in 0..h / 8 {
        for tx in 0..tw {
            let base = (ty * tw + tx) * 64;
            for y in 0..8 {
                let row = (ty * 8 + y) * w + tx * 8;
                out.px[row..row + 8].copy_from_slice(&px[base + y * 8..base + y * 8 + 8]);
            }
        }
    }
    Ok(out)
}

pub fn linear(px: &[u8], w: usize, h: usize) -> Result<Indexed> {
    if px.len() < w * h {
        return err("画素が足りません");
    }
    Ok(Indexed { w, h, px: px[..w * h].to_vec() })
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Layout {
    Tiled,
    Linear,
}

/// 画素データを h×w のインデックス配列にする
pub fn decode(b: &[u8], w: usize, h: usize, bpp: u32, layout: Layout) -> Result<Indexed> {
    let px = match bpp {
        4 => unpack4(b),
        1 => unpack1(b),
        _ => b.to_vec(),
    };
    match layout {
        Layout::Tiled => tiled(&px, w, h),
        Layout::Linear => linear(&px, w, h),
    }
}

/// OBJ の 1D マッピング: bw×bh のブロックごとにタイルが連続して並ぶ。ブロックを左上から横方向に並べる
pub fn obj_blocks(px: &[u8], w: usize, h: usize, bw: usize, bh: usize) -> Result<Indexed> {
    let n = (w / bw) * (h / bh);
    let b = tiled(&px[..(w * h).min(px.len())], bw, bh * n)?; // ブロックを縦に積んだ画像
    let mut out = Indexed::zeros(w, h);
    let cols = w / bw;
    for k in 0..n {
        let (bx, by) = (k % cols, k / cols);
        for y in 0..bh {
            for x in 0..bw {
                out.px[(by * bh + y) * w + bx * bw + x] = b.px[(k * bh + y) * bw + x];
            }
        }
    }
    Ok(out)
}

fn encode(w: usize, h: usize, color: png::ColorType, pal: Option<Vec<u8>>, trns: Option<Vec<u8>>, data: &[u8]) -> Vec<u8> {
    let mut buf = Vec::new();
    {
        let mut e = png::Encoder::new(&mut buf, w as u32, h as u32);
        e.set_color(color);
        e.set_depth(png::BitDepth::Eight);
        e.set_compression(png::Compression::Fast);
        if let Some(p) = pal {
            e.set_palette(p);
        }
        if let Some(t) = trns {
            e.set_trns(t);
        }
        let mut wr = e.write_header().expect("PNG の見出し");
        wr.write_image_data(data).expect("PNG の画素");
    }
    buf
}

/// インデックス配列とパレットから 8bit インデックスカラーの PNG を作る（gfx.write_png と同じパレットの扱い）
pub fn png_indexed(idx: &Indexed, pal: &[Rgb], transparent0: bool) -> Vec<u8> {
    let mut pal: Vec<Rgb> = pal.iter().take(256).copied().collect();
    if pal.is_empty() {
        pal = gray(8);
    }
    let mx = idx.px.iter().copied().max().unwrap_or(0) as usize;
    if mx >= pal.len() {
        pal.resize(mx + 1, [255, 0, 255]);
    }
    let flat: Vec<u8> = pal.iter().flatten().copied().collect();
    let trns = transparent0.then(|| vec![0u8]);
    encode(idx.w, idx.h, png::ColorType::Indexed, Some(flat), trns, &idx.px)
}

/// RGBA の PNG
pub fn png_rgba(img: &Rgba) -> Vec<u8> {
    encode(img.w, img.h, png::ColorType::Rgba, None, None, &img.px)
}

/// 8 ビットの白黒の PNG
pub fn png_gray(w: usize, h: usize, data: &[u8]) -> Vec<u8> {
    encode(w, h, png::ColorType::Grayscale, None, None, data)
}

/// 色番号の画像をパレットで RGBA にする（色番号 0 は透明）
pub fn to_rgba(idx: &Indexed, pal: &[Rgb]) -> Rgba {
    let mut out = Rgba::zeros(idx.w, idx.h);
    for (i, &c) in idx.px.iter().enumerate() {
        let rgb = pal[c as usize];
        out.px[i * 4..i * 4 + 3].copy_from_slice(&rgb);
        out.px[i * 4 + 3] = if c != 0 { 255 } else { 0 };
    }
    out
}

/// 繰り返す GIF（各コマは全体の大きさ、色番号 0 が透明、前のコマは背景で消す）。ImageMagick の
/// `magick -dispose background -delay D f00.png … -loop 0 anim.gif` と同じ見え方になる（1 コマ 255 色まで）
pub fn gif_anim(frames: &[(&Rgba, u16)]) -> Vec<u8> {
    let Some((first, _)) = frames.first() else { return Vec::new() };
    let mut buf = Vec::new();
    {
        let mut enc = gif::Encoder::new(&mut buf, first.w as u16, first.h as u16, &[]).expect("GIF");
        enc.set_repeat(gif::Repeat::Infinite).expect("GIF");
        for (img, delay) in frames {
            let mut pal: Vec<[u8; 3]> = vec![[0, 0, 0]];
            let mut idx = Vec::with_capacity(img.w * img.h);
            for p in img.px.as_chunks::<4>().0 {
                if p[3] == 0 {
                    idx.push(0u8);
                    continue;
                }
                let c = [p[0], p[1], p[2]];
                let k = match pal.iter().skip(1).position(|x| *x == c) {
                    Some(k) => k + 1,
                    None => {
                        pal.push(c);
                        pal.len() - 1
                    }
                };
                idx.push(k.min(255) as u8);
            }
            let mut size = 2;
            while size < pal.len() {
                size *= 2;
            }
            pal.resize(size, [0, 0, 0]);
            let f = gif::Frame {
                width: img.w as u16,
                height: img.h as u16,
                buffer: std::borrow::Cow::Owned(idx),
                palette: Some(pal.into_iter().flatten().collect()),
                transparent: Some(0),
                dispose: gif::DisposalMethod::Background,
                delay: *delay,
                ..Default::default()
            };
            enc.write_frame(&f).expect("GIF");
        }
    }
    buf
}

/// ImageMagick に渡していた -delay（1/100 秒）: max(2, round(min(長さ, 120) × 100 / 60))
pub fn gif_delay(frames_60: u32) -> u16 {
    ((frames_60.min(120) as f64 * 100.0 / 60.0).round() as u16).max(2)
}
