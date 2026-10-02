//! data.bin の先頭に並ぶ 8 個の画像アーカイブの書き出し（ex_archives.py）。
//!
//! どのアーカイブもパック形式で、中身はすべて DS 標準の圧縮データ。
//!   0: RLE → 20512 = パレット 32 + 4bpp タイル 256×160、1〜3 → 24608 = パレット 32 + 4bpp 256×192、
//!   4〜7 → 6144 = 1bpp 256×192 のマスク（下位ビットが左）

use crate::bytes::{err, Result};
use crate::databin::read_pack;
use crate::gfx::{self, Indexed, Layout, Rgb};
use crate::nitro::decompress;
use crate::sink::Sink;

/// 先頭から続くアーカイブの位置の一覧
pub fn archive_offsets(d: &[u8], count: usize) -> Result<Vec<usize>> {
    let mut out = Vec::new();
    let mut p = 0usize;
    for _ in 0..count {
        let Some((_, end)) = read_pack(d, p) else {
            return err(format!("アーカイブが読めません: {p:#x}"));
        };
        out.push(p);
        p = (p + end + 3) & !3;
    }
    Ok(out)
}

/// 展開済みのデータを (インデックス配列, パレット) にする。形式が分からなければ None
pub fn decode_entry(b: &[u8]) -> Option<(Indexed, Vec<Rgb>)> {
    let (w, h, bpp, pal_size) = match b.len() {
        20512 => (256, 160, 4, 32),
        24608 => (256, 192, 4, 32),
        6144 => (256, 192, 1, 0),
        _ => return None,
    };
    if bpp == 1 {
        return Some((
            gfx::decode(b, w, h, 1, Layout::Linear).ok()?,
            vec![[0, 0, 0], [255, 255, 255]],
        ));
    }
    Some((
        gfx::decode(&b[pal_size..], w, h, bpp, Layout::Tiled).ok()?,
        gfx::palette(&b[..pal_size]),
    ))
}

/// アーカイブをすべて書き出す（書き出し先は data/）。(項目の数, 画像の数, 空) を返す
pub fn export(d: &[u8], out: &mut dyn Sink, raw: bool) -> Result<Vec<(usize, usize, usize)>> {
    let mut summary = Vec::new();
    for (n, base) in archive_offsets(d, 8)?.into_iter().enumerate() {
        let (ents, _) = read_pack(d, base).unwrap();
        let (mut pngs, mut empty) = (0, 0);
        for (i, &(p, _)) in ents.iter().enumerate() {
            let (b, _) = decompress(d, p)?;
            let r = decode_entry(&b);
            if raw {
                out.put(&format!("archive{n}/{i:04}.bin"), b);
            }
            let Some((idx, pal)) = r else { continue };
            if !idx.any() {
                empty += 1;
                continue;
            }
            out.put(
                &format!("archive{n}/{i:04}.png"),
                gfx::png_indexed(&idx, &pal, false),
            );
            pngs += 1;
        }
        out.log(&format!(
            "  archive{n}: {} 個 → 画像 {pngs} 枚（空 {empty}）",
            ents.len()
        ));
        summary.push((ents.len(), pngs, empty));
    }
    Ok(summary)
}
