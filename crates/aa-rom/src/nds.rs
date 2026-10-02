//! NDS の ROM イメージの読み出し（nds.py と arm9.py の Arm9 に当たる）。ROM は変更しない。

use crate::bytes::{err, u16_at, u32_at, u8_at, Error, Result};

/// NitroFS の 1 ファイル
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NdsFile {
    pub id: u16,
    pub path: String,
    pub start: usize,
    pub end: usize,
}

/// ファイル名の表（FNT）と位置の表（FAT）から、ROM 内のファイル一覧を作る（FNT の並び順）
pub fn list_files(rom: &[u8]) -> Result<Vec<NdsFile>> {
    let fnt = u32_at(rom, 0x40)? as usize;
    let fat = u32_at(rom, 0x48)? as usize;
    let mut files = Vec::new();
    walk(rom, fnt, fat, 0xF000, "", &mut files, 0)?;
    Ok(files)
}

fn walk(
    rom: &[u8],
    fnt: usize,
    fat: usize,
    dir_id: u16,
    prefix: &str,
    out: &mut Vec<NdsFile>,
    depth: u32,
) -> Result<()> {
    if depth > 64 {
        return err("FNT の入れ子が深すぎます");
    }
    let entry = fnt + (dir_id as usize & 0xFFF) * 8;
    let mut p = fnt + u32_at(rom, entry)? as usize;
    let mut file_id = u16_at(rom, entry + 4)?;
    loop {
        let n = u8_at(rom, p)?;
        p += 1;
        if n == 0 {
            break;
        }
        let len = (n & 0x7F) as usize;
        let raw = rom
            .get(p..p + len)
            .ok_or_else(|| Error("FNT の名前が範囲外".into()))?;
        let (name, _, _) = encoding_rs::SHIFT_JIS.decode(raw);
        p += len;
        if n > 0x80 {
            let sub = u16_at(rom, p)?;
            p += 2;
            walk(
                rom,
                fnt,
                fat,
                sub,
                &format!("{prefix}{name}/"),
                out,
                depth + 1,
            )?;
        } else {
            let start = u32_at(rom, fat + file_id as usize * 8)? as usize;
            let end = u32_at(rom, fat + file_id as usize * 8 + 4)? as usize;
            out.push(NdsFile {
                id: file_id,
                path: format!("{prefix}{name}"),
                start,
                end,
            });
            file_id = file_id.wrapping_add(1);
        }
    }
    Ok(())
}

/// プログラム本体（ARM9）
pub fn arm9(rom: &[u8]) -> Result<&[u8]> {
    let off = u32_at(rom, 0x20)? as usize;
    let size = u32_at(rom, 0x2C)? as usize;
    Ok(crate::bytes::py_slice(rom, off, off + size))
}

/// ARM9 が置かれる番地
pub const ARM9_BASE: u32 = 0x0200_0000;

/// ARM9 のメモリの見かけ（本体 + autoload の写し先）。arm9.py の Arm9 と同じ
pub struct Arm9<'a> {
    pub img: &'a [u8],
    regions: Vec<(u32, &'a [u8])>,
}

impl<'a> Arm9<'a> {
    pub fn new(rom: &'a [u8]) -> Result<Self> {
        let img = arm9(rom)?;
        let mut regions = vec![(ARM9_BASE, img)];
        // autoload の一覧（本体の末尾近く、0x020cd180〜）。ITCM と DTCM へ写される
        let mut src = 0x020c_b040u32;
        for i in 0..2 {
            let dst = u32_at(img, 0xcd180 + i * 12)?;
            let size = u32_at(img, 0xcd180 + i * 12 + 4)? as usize;
            let o = (src - ARM9_BASE) as usize;
            regions.push((dst, crate::bytes::py_slice(img, o, o + size)));
            src = src.wrapping_add(size as u32);
        }
        Ok(Arm9 { img, regions })
    }

    fn find(&self, addr: u32) -> Option<(&'a [u8], usize)> {
        for &(base, data) in &self.regions {
            if base <= addr && (addr as u64) < base as u64 + data.len() as u64 {
                return Some((data, (addr - base) as usize));
            }
        }
        None
    }

    /// Python の read(addr, n): 領域の終わりで切れることがある
    pub fn read(&self, addr: u32, n: usize) -> Result<&'a [u8]> {
        let (data, o) = self
            .find(addr)
            .ok_or_else(|| Error(format!("範囲外: {addr:#x}")))?;
        Ok(crate::bytes::py_slice(data, o, o + n))
    }

    pub fn u32(&self, addr: u32) -> Result<u32> {
        let b = self.read(addr, 4)?;
        if b.len() < 4 {
            return err(format!("範囲外: {addr:#x}"));
        }
        Ok(u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    }

    pub fn u16(&self, addr: u32) -> Result<u16> {
        let b = self.read(addr, 2)?;
        if b.len() < 2 {
            return err(format!("範囲外: {addr:#x}"));
        }
        Ok(u16::from_le_bytes([b[0], b[1]]))
    }

    pub fn u8(&self, addr: u32) -> Result<u8> {
        let b = self.read(addr, 1)?;
        b.first()
            .copied()
            .ok_or_else(|| Error(format!("範囲外: {addr:#x}")))
    }
}
