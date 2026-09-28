//! RomFS（IVFC の第 3 層）のファイル一覧。
//!
//! 第 3 層の位置 = (0x60 + マスターハッシュの大きさ) をブロックの大きさ（IVFC 0x4C の 2 の冪）に切り上げたところ。
//! 第 3 層の見出しは u32 × 10（見出しの大きさ、ディレクトリのハッシュ表・情報、ファイルのハッシュ表・情報の位置と大きさ、
//! データの位置）。ディレクトリの情報は (親, 兄弟, 最初の子, 最初のファイル, ハッシュの次, 名前の長さ, 名前 UTF-16)、
//! ファイルの情報は (親, 兄弟, u64 データの位置, u64 大きさ, ハッシュの次, 名前の長さ, 名前 UTF-16)。

use crate::ncch::{Ncch, Part};
use crate::{u32le, u64le};
use std::fs::File;

pub struct Entry {
    pub path: String,
    /// RomFS の先頭からの位置
    pub offset: u64,
    pub size: u64,
}

const NONE: u32 = 0xFFFF_FFFF;

pub fn list(ncch: &Ncch, f: &mut File) -> crate::Result<Vec<Entry>> {
    let ivfc = ncch.read(f, Part::RomFs, 0, 0x60)?;
    if &ivfc[..4] != b"IVFC" {
        return Err("RomFS の見出しが読めません（鍵が違う可能性があります）".into());
    }
    let block = 1u64 << u32le(&ivfc, 0x4C);
    let l3 = (0x60 + u32le(&ivfc, 0x08) as u64 + block - 1) & !(block - 1);
    let h = ncch.read(f, Part::RomFs, l3, 0x28)?;
    let field = |i: usize| u32le(&h, i * 4) as u64;
    let dirs = ncch.read(f, Part::RomFs, l3 + field(3), field(4) as usize)?;
    let files = ncch.read(f, Part::RomFs, l3 + field(7), field(8) as usize)?;
    let data = l3 + field(9);
    let mut out = Vec::new();
    walk(&dirs, &files, data, 0, "", &mut out);
    Ok(out)
}

fn name(meta: &[u8], at: usize, len: usize) -> String {
    let units: Vec<u16> = meta[at..at + len]
        .as_chunks::<2>()
        .0
        .iter()
        .map(|c| u16::from_le_bytes(*c))
        .collect();
    String::from_utf16_lossy(&units)
}

fn walk(dirs: &[u8], files: &[u8], data: u64, d: usize, prefix: &str, out: &mut Vec<Entry>) {
    let path = if d == 0 {
        String::new()
    } else {
        format!(
            "{prefix}{}/",
            name(dirs, d + 0x18, u32le(dirs, d + 0x14) as usize)
        )
    };
    let mut file = u32le(dirs, d + 0x0C);
    while file != NONE {
        let e = file as usize;
        out.push(Entry {
            path: format!(
                "{path}{}",
                name(files, e + 0x20, u32le(files, e + 0x1C) as usize)
            ),
            offset: data + u64le(files, e + 8),
            size: u64le(files, e + 0x10),
        });
        file = u32le(files, e + 4);
    }
    let mut child = u32le(dirs, d + 8);
    while child != NONE {
        walk(dirs, files, data, child as usize, &path, out);
        child = u32le(dirs, child as usize + 4);
    }
}
