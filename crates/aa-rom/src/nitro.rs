//! DS 標準の圧縮形式（LZ77 = 0x10、LZ11 = 0x11、RLE = 0x30）の展開（nitro.py）。
//!
//! どの関数も、データ d の位置 p から展開して (展開したバイト列, 読んだバイト数) を返す。
//! 読み出しが範囲外になったら Err（Python の IndexError と同じ所で失敗する）。

use crate::bytes::{err, u32_at, u8_at, Result};

pub const COMPRESSION_TYPES: [u8; 3] = [0x10, 0x11, 0x30];

#[inline]
fn back(out: &mut Vec<u8>, disp: usize, n: usize) -> Result<()> {
    if disp > out.len() {
        return err("LZ の参照が範囲外");
    }
    for _ in 0..n {
        let b = out[out.len() - disp];
        out.push(b);
    }
    Ok(())
}

/// DS LZ77 (0x10)
pub fn lz10(d: &[u8], p: usize) -> Result<(Vec<u8>, usize)> {
    if u8_at(d, p)? != 0x10 {
        return err("LZ10 ではありません");
    }
    let size = (u32_at(d, p)? >> 8) as usize;
    let mut q = p + 4;
    let mut out = Vec::with_capacity(size);
    while out.len() < size {
        let flags = u8_at(d, q)?;
        q += 1;
        for bit in 0..8 {
            if out.len() >= size {
                break;
            }
            if flags & (0x80 >> bit) != 0 {
                let b1 = u8_at(d, q)? as usize;
                let b2 = u8_at(d, q + 1)? as usize;
                q += 2;
                let n = (b1 >> 4) + 3;
                let disp = ((b1 & 0xf) << 8 | b2) + 1;
                back(&mut out, disp, n)?;
            } else {
                out.push(u8_at(d, q)?);
                q += 1;
            }
        }
    }
    out.truncate(size);
    Ok((out, q - p))
}

/// LZ11 (0x11)
pub fn lz11(d: &[u8], p: usize) -> Result<(Vec<u8>, usize)> {
    if u8_at(d, p)? != 0x11 {
        return err("LZ11 ではありません");
    }
    let size = (u32_at(d, p)? >> 8) as usize;
    let mut q = p + 4;
    let mut out = Vec::with_capacity(size);
    while out.len() < size {
        let flags = u8_at(d, q)?;
        q += 1;
        for bit in 0..8 {
            if out.len() >= size {
                break;
            }
            if flags & (0x80 >> bit) != 0 {
                let b = u8_at(d, q)? as usize;
                let ind = b >> 4;
                let (n, disp);
                if ind == 0 {
                    let b1 = u8_at(d, q + 1)? as usize;
                    let b2 = u8_at(d, q + 2)? as usize;
                    n = ((b & 0xf) << 4 | b1 >> 4) + 0x11;
                    disp = ((b1 & 0xf) << 8 | b2) + 1;
                    q += 3;
                } else if ind == 1 {
                    let b1 = u8_at(d, q + 1)? as usize;
                    let b2 = u8_at(d, q + 2)? as usize;
                    let b3 = u8_at(d, q + 3)? as usize;
                    n = ((b & 0xf) << 12 | b1 << 4 | b2 >> 4) + 0x111;
                    disp = ((b2 & 0xf) << 8 | b3) + 1;
                    q += 4;
                } else {
                    let b1 = u8_at(d, q + 1)? as usize;
                    n = ind + 1;
                    disp = ((b & 0xf) << 8 | b1) + 1;
                    q += 2;
                }
                back(&mut out, disp, n)?;
            } else {
                out.push(u8_at(d, q)?);
                q += 1;
            }
        }
    }
    out.truncate(size);
    Ok((out, q - p))
}

/// RLE (0x30)。Python と同じく、そのまま写す部分がデータの末尾を越えたら黙って切り詰める
pub fn rle(d: &[u8], p: usize) -> Result<(Vec<u8>, usize)> {
    if u8_at(d, p)? != 0x30 {
        return err("RLE ではありません");
    }
    let size = (u32_at(d, p)? >> 8) as usize;
    let mut q = p + 4;
    let mut out = Vec::with_capacity(size);
    while out.len() < size {
        let f = u8_at(d, q)?;
        q += 1;
        if f & 0x80 != 0 {
            let n = (f & 0x7f) as usize + 3;
            let b = u8_at(d, q)?;
            out.extend(std::iter::repeat_n(b, n));
            q += 1;
        } else {
            let n = (f & 0x7f) as usize + 1;
            out.extend_from_slice(crate::bytes::py_slice(d, q, q + n));
            q += n;
        }
    }
    out.truncate(size);
    Ok((out, q - p))
}

/// 先頭の 1 バイトで形式を判断して展開する
pub fn decompress(d: &[u8], p: usize) -> Result<(Vec<u8>, usize)> {
    match u8_at(d, p)? {
        0x10 => lz10(d, p),
        0x11 => lz11(d, p),
        0x30 => rle(d, p),
        t => err(format!("知らない圧縮の形式 {t:#x}")),
    }
}
