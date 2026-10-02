//! 法廷の机（弁護側・検察側・証言台）の書き出し（ex_desks.py）。
//!
//! 机は OBJ（スプライト）で、data.bin の 0x1a7ffb4〜0x1ab13d4 の生のタイル・パレットの領域にある。
//! 並べ方は ARM9 のコード（0x0201e558 から）に直接書かれている。OBJ は 1D マッピング、色番号 0 は透明。

use crate::bytes::{err, py_slice, u32le, Result};
use crate::gfx::{self, Rgba};
use crate::sink::Sink;

const COURT_TILES: (usize, usize) = (0x1a9b274, 0x1900); // 弁護側・検察側: 200 枚
const COURT_PAL: usize = 0x1ab1114;
const WITNESS_TILES: (usize, usize) = (0x1a9a674, 0xc00); // 証言台: 96 枚
const WITNESS_PAL: usize = 0x1ab10f4;

/// (x, y, 幅, 高さ, 先頭から何枚目のタイルか, 左右反転)
type Obj = (usize, usize, usize, usize, usize, bool);

pub const DESKS: [(&str, (usize, usize), usize, [Obj; 4]); 3] = [
    (
        "defense",
        COURT_TILES,
        COURT_PAL,
        [
            (0, 144, 64, 64, 0, false),
            (64, 144, 64, 64, 64, false),
            (128, 144, 64, 64, 128, false),
            (192, 160, 16, 32, 192, false),
        ],
    ),
    (
        "prosecution",
        COURT_TILES,
        COURT_PAL,
        [
            (48, 160, 16, 32, 192, true),
            (64, 144, 64, 64, 128, true),
            (128, 144, 64, 64, 64, true),
            (192, 144, 64, 64, 0, true),
        ],
    ),
    (
        "witness",
        WITNESS_TILES,
        WITNESS_PAL,
        [
            (32, 152, 64, 64, 0, false),
            (96, 152, 32, 64, 64, false),
            (128, 152, 32, 64, 64, true),
            (160, 152, 64, 64, 0, true),
        ],
    ),
];

/// 机を 256×192 の画面の上の位置に置いた RGBA 画像
pub fn render(d: &[u8], name: &str) -> Result<Rgba> {
    let Some(&(_, (off, size), pal_off, objs)) = DESKS.iter().find(|x| x.0 == name) else {
        return err(format!("知らない机: {name}"));
    };
    let tiles = gfx::unpack4(py_slice(d, off, off + size));
    let pal = gfx::palette(py_slice(d, pal_off, pal_off + 32));
    let mut can = Rgba::zeros(256, 192);
    for (x, y, w, h, first, flip) in objs {
        let n = (w / 8) * (h / 8);
        let t = py_slice(&tiles, first * 64, (first + n) * 64);
        let idx = gfx::tiled(t, w, h)?;
        let (vh, vw) = (
            h.min(192usize.saturating_sub(y)),
            w.min(256usize.saturating_sub(x)),
        );
        for yy in 0..vh {
            for xx in 0..vw {
                let sx = if flip { w - 1 - xx } else { xx };
                let c = idx.at(sx, yy);
                if c != 0 {
                    let p = ((y + yy) * 256 + x + xx) * 4;
                    let rgb = pal[c as usize];
                    can.px[p..p + 4].copy_from_slice(&[rgb[0], rgb[1], rgb[2], 255]);
                }
            }
        }
    }
    Ok(can)
}

/// ARM9 のリテラルに位置が載っていることを確かめる（別の版の ROM で黙って間違えないように）
pub fn check_arm9(arm9: &[u8]) -> Result<()> {
    let expected = [COURT_TILES.0, COURT_PAL, WITNESS_TILES.0, WITNESS_PAL];
    let words: std::collections::HashSet<u32> =
        (0..arm9.len() / 4).map(|i| u32le(arm9, i * 4)).collect();
    let missing: Vec<String> = expected
        .iter()
        .filter(|&&v| !words.contains(&(v as u32)))
        .map(|v| format!("{v:#x}"))
        .collect();
    if !missing.is_empty() {
        return err(format!(
            "ARM9 に机の位置が見つかりません（別の版の ROM？）: {}",
            missing.join(", ")
        ));
    }
    Ok(())
}

/// data/desks/ に書き出す（out の根は data/desks）
pub fn export(d: &[u8], arm9: &[u8], out: &mut dyn Sink) -> Result<()> {
    check_arm9(arm9)?;
    for (name, ..) in DESKS {
        let img = render(d, name)?;
        out.put(&format!("{name}.png"), gfx::png_rgba(&img));
    }
    Ok(())
}
