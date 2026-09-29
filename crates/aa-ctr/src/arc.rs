//! MT Framework（3DS 版）の ARC。"ARC\0"、u16 版（5 は 0x10、6 は 0x11）、u16 個数、4 バイト空き、
//! 項目 0x50 バイト（名前 64 バイト、u32 種類のハッシュ、u32 圧縮後の大きさ、u32 展開後の大きさ | 0x40000000、u32 位置）。
//! 中身は zlib。

use crate::u32le;
use flate2::read::ZlibDecoder;
use std::io::Read;

pub struct Item {
    /// 区切りは '/'
    pub name: String,
    pub type_hash: u32,
    pub body: Vec<u8>,
}

pub fn items(data: &[u8]) -> crate::Result<Vec<Item>> {
    if data.get(..4) != Some(b"ARC\0") {
        return Err("ARC ではありません".into());
    }
    let count = crate::u16le(data, 6) as usize;
    let mut out = Vec::with_capacity(count);
    for i in 0..count {
        let e = 0x0C + i * 0x50;
        let raw = &data[e..e + 64];
        let name = String::from_utf8_lossy(&raw[..raw.iter().position(|&c| c == 0).unwrap_or(64)])
            .replace('\\', "/");
        let (type_hash, csize, dsize, off) = (
            u32le(data, e + 64),
            u32le(data, e + 68) as usize,
            u32le(data, e + 72) as usize,
            u32le(data, e + 76) as usize,
        );
        let mut body = Vec::with_capacity(dsize & 0x1FFF_FFFF);
        if csize > 0 {
            ZlibDecoder::new(&data[off..off + csize])
                .read_to_end(&mut body)
                .map_err(|e| format!("{name}: {e}"))?;
        }
        if body.len() != dsize & 0x1FFF_FFFF {
            return Err(format!("{name}: 展開後の大きさが合いません"));
        }
        out.push(Item {
            name,
            type_hash,
            body,
        });
    }
    Ok(out)
}

/// 拡張子は中身の先頭 4 バイト（"TEX\0" → tex）。文字でなければ種類のハッシュ
pub fn ext_of(body: &[u8], type_hash: u32) -> String {
    let head = &body[..body.len().min(4)];
    let end = head
        .iter()
        .rposition(|&c| c != 0 && c != 0xFF)
        .map_or(0, |p| p + 1);
    let magic = &head[..end];
    if !magic.is_empty() && magic.iter().all(|&c| (0x30..0x7F).contains(&c)) {
        String::from_utf8_lossy(magic).to_lowercase()
    } else {
        format!("{type_hash:08x}")
    }
}
