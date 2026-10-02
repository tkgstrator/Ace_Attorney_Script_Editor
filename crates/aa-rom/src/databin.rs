//! data.bin の構造の読み取り（databin.py）。
//!
//! data.bin は目次を持たず、パック（u32 個数 N と N 組の (u32 位置, u32 大きさ)）・DS 標準の圧縮データ・
//! テクスチャ（20 バイトの見出し + 線形の画素 + パレット）が 4 バイト境界で並んでいる。

use std::collections::{BTreeMap, HashMap, HashSet};

use crate::bytes::u32le;
use crate::nitro::{decompress, COMPRESSION_TYPES};

/// 先頭に並ぶ画像アーカイブの数
pub const ARCHIVE_COUNT: usize = 8;

/// テクスチャ形式ごとの 1 画素のビット数
pub fn tex_bpp(fmt: u8) -> Option<u32> {
    match fmt {
        1 => Some(8),
        2 => Some(2),
        3 => Some(4),
        4 => Some(8),
        5 => Some(2),
        6 => Some(8),
        7 => Some(16),
        _ => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TexHeader {
    pub fmt: u8,
    pub w: usize,
    pub h: usize,
    pub px_off: usize,
    pub px_size: usize,
    pub pal_off: usize,
    pub pal_size: usize,
}

impl TexHeader {
    pub fn total(&self) -> usize {
        (self.px_off + self.px_size).max(self.pal_off + self.pal_size)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ItemInfo {
    /// パックの中身 [(絶対位置, 大きさ)]
    Pack(Vec<(usize, usize)>),
    /// 展開後の大きさ
    Blob(usize),
    Tex(TexHeader),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Item {
    pub offset: usize,
    pub size: usize,
    pub info: ItemInfo,
}

impl Item {
    pub fn kind(&self) -> &'static str {
        match self.info {
            ItemInfo::Pack(_) => "pack",
            ItemInfo::Blob(_) => "blob",
            ItemInfo::Tex(_) => "tex",
        }
    }
}

/// base からパックとして読めれば ([(絶対位置, 大きさ)], 全体の大きさ) を返す
pub fn read_pack(d: &[u8], base: usize) -> Option<(Vec<(usize, usize)>, usize)> {
    read_pack_max(d, base, 4096)
}

pub fn read_pack_max(
    d: &[u8],
    base: usize,
    max_count: usize,
) -> Option<(Vec<(usize, usize)>, usize)> {
    if base + 4 > d.len() {
        return None;
    }
    let n = u32le(d, base) as usize;
    if !(1..=max_count).contains(&n) || base + 4 + 8 * n > d.len() {
        return None;
    }
    let ents: Vec<(usize, usize)> = (0..n)
        .map(|k| {
            (
                u32le(d, base + 4 + 8 * k) as usize,
                u32le(d, base + 8 + 8 * k) as usize,
            )
        })
        .collect();
    let mut end = 4 + 8 * n;
    if ents[0].0 != end {
        return None;
    }
    for &(off, size) in &ents {
        if off < end || off - end > 3 || size == 0 {
            return None;
        }
        end = off + size;
    }
    if base + end > d.len() {
        return None;
    }
    Some((ents.iter().map(|&(o, s)| (base + o, s)).collect(), end))
}

/// p にテクスチャの見出しがあれば返す
pub fn tex_header(d: &[u8], p: usize) -> Option<TexHeader> {
    if p + 20 > d.len() || d[p + 3] != 0 || d[p + 1] > 7 || d[p + 2] > 7 {
        return None;
    }
    let bpp = tex_bpp(d[p])? as usize;
    let (px_off, px_size, pal_off, pal_size) = (
        u32le(d, p + 4) as usize,
        u32le(d, p + 8) as usize,
        u32le(d, p + 12) as usize,
        u32le(d, p + 16) as usize,
    );
    let (w, h) = (8usize << d[p + 1], 8usize << d[p + 2]);
    if px_off != 0x14 || px_size != w * h * bpp / 8 {
        return None;
    }
    if pal_off != px_off + px_size || pal_size > 0x200 || pal_size % 4 != 0 {
        return None;
    }
    let t = TexHeader {
        fmt: d[p],
        w,
        h,
        px_off,
        px_size,
        pal_off,
        pal_size,
    };
    (p + t.total() <= d.len()).then_some(t)
}

/// p に DS 標準の圧縮データがあれば (読んだバイト数, 展開後の大きさ) を返す。
/// 展開後の大きさが 4 の倍数でないものは、ほぼ誤検出なので捨てる
pub fn try_blob(d: &[u8], p: usize) -> Option<(usize, usize)> {
    if p + 4 > d.len() || !COMPRESSION_TYPES.contains(&d[p]) {
        return None;
    }
    let size = (u32le(d, p) >> 8) as usize;
    if !(16..=0x200000).contains(&size) || !size.is_multiple_of(4) {
        return None;
    }
    let (out, used) = decompress(d, p).ok()?;
    (out.len() == size).then_some((used, size))
}

/// data.bin を先頭から順に、パック・テクスチャ・圧縮データとして読める所を拾っていく
pub fn walk(d: &[u8]) -> Vec<Item> {
    let mut items = Vec::new();
    let mut p = 0usize;
    while p + 4 < d.len() {
        if let Some((ents, size)) = read_pack(d, p) {
            items.push(Item {
                offset: p,
                size,
                info: ItemInfo::Pack(ents),
            });
            p = (p + size + 3) & !3;
            continue;
        }
        if let Some(t) = tex_header(d, p) {
            items.push(Item {
                offset: p,
                size: t.total(),
                info: ItemInfo::Tex(t),
            });
            p = (p + t.total() + 3) & !3;
            continue;
        }
        if let Some((used, size)) = try_blob(d, p) {
            items.push(Item {
                offset: p,
                size: used,
                info: ItemInfo::Blob(size),
            });
            p = (p + used + 3) & !3;
            continue;
        }
        p += 4;
    }
    items
}

/// どれにも当てはまらなかった領域 (位置, 大きさ) の一覧
pub fn gaps(items: &[Item], total: usize, min_size: usize) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    let mut prev = 0usize;
    for it in items {
        if it.offset >= prev + min_size {
            out.push((prev, it.offset - prev));
        }
        prev = prev.max((it.offset + it.size + 3) & !3);
    }
    if total >= prev + min_size {
        out.push((prev, total - prev));
    }
    out
}

// ---- ARM9 の中の表 ----

fn cstr_name(a: &[u8], ptr: u32) -> Option<String> {
    let o = ptr.checked_sub(0x0200_0000)? as usize;
    if o >= a.len() {
        return None;
    }
    // Python の a.find(b'\0', o) が -1 のときは a[o:-1]（最後の 1 バイトを除く）
    let e = a[o..]
        .iter()
        .position(|&b| b == 0)
        .map(|e| o + e)
        .unwrap_or(a.len() - 1);
    let t = crate::bytes::py_slice(a, o, e);
    if t.len() < 3 || !t.iter().all(|&c| 32 < c && c < 127) {
        return None;
    }
    Some(String::from_utf8_lossy(t).into_owned())
}

/// ARM9 の中の (u32 名前へのポインタ, u32 位置, u32 大きさ) の組を探し、位置 → 名前 を返す
pub fn named_resources(a: &[u8], data_size: usize) -> BTreeMap<usize, String> {
    let mut out = BTreeMap::new();
    let mut i = 0;
    while i + 12 < a.len() {
        let (ptr, off, size) = (
            u32le(a, i),
            u32le(a, i + 4) as usize,
            u32le(a, i + 8) as usize,
        );
        if (0x0200_0000..0x0200_0000 + a.len() as u64).contains(&(ptr as u64))
            && 0 < off
            && off < data_size
            && 0 < size
            && size < 0x400000
            && off + size <= data_size
        {
            if let Some(name) = cstr_name(a, ptr) {
                if !name.contains('/') && !out.contains_key(&off) {
                    out.insert(off, name);
                }
            }
        }
        i += 4;
    }
    out
}

/// 背景の表（16 バイト: u32 位置, u32 大きさ, u32 フラグ, u32 0x8000）を探し、位置 → 表の中の番号 を返す
pub fn bg_table(a: &[u8], packs: &HashSet<usize>) -> HashMap<usize, usize> {
    let mut out = HashMap::new();
    let mut i = 0;
    while i + 16 < a.len() {
        let off = u32le(a, i) as usize;
        let tail = u32le(a, i + 12);
        if tail == 0x8000 && packs.contains(&off) && !out.contains_key(&off) {
            let n = out.len();
            out.insert(off, n);
        }
        i += 4;
    }
    out
}
