//! SDAT（Nintendo の標準の音声アーカイブ）の分割と INFO の読み出し（sound.py・sdat_info.py）。
//!
//! INFO の表:
//!   シーケンス: u16 ファイル番号, u16 ?, u16 バンク, u8 音量, u8 チャンネルの優先度, u8 プレイヤーの優先度, u8 プレイヤー
//!   バンク: u16 ファイル番号, u16 ?, u16 × 4 波形書庫（0xFFFF = 無し）/ 波形書庫: u16 ファイル番号
//!   プレイヤー: u8 同時に鳴らせる数, u8 ?, u16 使えるチャンネル（0 = すべて）, u32 ヒープ

use std::collections::BTreeMap;

use crate::bytes::{cstr, err, u16_at, u32_at, u8_at, Result};

/// INFO/SYMB の表の番号 → 種類
const KINDS: [(usize, &str); 5] = [(0, "sequence"), (1, "seqarc"), (2, "bank"), (3, "wavearc"), (7, "stream")];

fn ext(magic: &[u8]) -> &'static str {
    match magic {
        b"SSEQ" => "sseq",
        b"SSAR" => "ssar",
        b"SBNK" => "sbnk",
        b"SWAR" => "swar",
        b"STRM" => "strm",
        _ => "bin",
    }
}

/// SYMB の表から名前の一覧を読む（名前の無いものは None）
pub fn names(s: &[u8], symb: usize, kind: usize) -> Result<Vec<Option<String>>> {
    if symb == 0 {
        return Ok(Vec::new());
    }
    let base = symb + u32_at(s, symb + 8 + 4 * kind)? as usize;
    let n = u32_at(s, base)? as usize;
    let step = if kind == 1 { 8 } else { 4 }; // SEQARC は (名前, 下位の表) の組
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let off = u32_at(s, base + 4 + step * i)? as usize;
        if off == 0 {
            out.push(None);
            continue;
        }
        out.push(Some(String::from_utf8_lossy(cstr(s, symb + off)).into_owned()));
    }
    Ok(out)
}

fn header(s: &[u8]) -> Result<(usize, usize, usize)> {
    if s.get(..4) != Some(b"SDAT") {
        return err("SDAT ではありません");
    }
    Ok((u32_at(s, 0x10)? as usize, u32_at(s, 0x18)? as usize, u32_at(s, 0x20)? as usize))
}

/// INFO のある種類の (添字, 位置) の一覧（位置 0 は飛ばす）
fn records(s: &[u8], info: usize, kind: usize) -> Result<Vec<(usize, usize)>> {
    let base = info + u32_at(s, info + 8 + 4 * kind)? as usize;
    let n = u32_at(s, base)? as usize;
    let mut out = Vec::new();
    for i in 0..n {
        let off = u32_at(s, base + 4 + 4 * i)? as usize;
        if off != 0 {
            out.push((i, off));
        }
    }
    Ok(out)
}

/// SDAT を (ファイル名, 中身) の一覧に分ける（sound.split）
pub fn split(s: &[u8]) -> Result<Vec<(String, Vec<u8>)>> {
    let (symb, info, fat) = header(s)?;
    let count = u32_at(s, fat + 8)? as usize;
    let mut named: BTreeMap<u16, String> = BTreeMap::new();
    for (kind, label) in KINDS {
        let names = names(s, symb, kind)?;
        for (i, off) in records(s, info, kind)? {
            let file_id = u16_at(s, info + off)?;
            let name = match names.get(i) {
                Some(Some(n)) if !n.is_empty() => n.clone(),
                _ => format!("{label}_{i:03}"),
            };
            named.entry(file_id).or_insert(format!("{label}/{name}"));
        }
    }
    let mut out = Vec::with_capacity(count);
    for fid in 0..count {
        let off = u32_at(s, fat + 12 + 16 * fid)? as usize;
        let size = u32_at(s, fat + 16 + 16 * fid)? as usize;
        let body = crate::bytes::py_slice(s, off, off + size).to_vec();
        let e = ext(crate::bytes::py_slice(&body, 0, 4));
        let base = named.get(&(fid as u16)).cloned().unwrap_or_else(|| format!("other/file_{fid:04}"));
        out.push((format!("{base}.{e}"), body));
    }
    Ok(out)
}

#[derive(Debug, Clone)]
pub struct SeqInfo {
    pub index: usize,
    pub name: String,
    pub file_id: u16,
    pub bank: u16,
    pub volume: u8,
    pub channel_prio: u8,
    pub player_prio: u8,
    pub player: u8,
}

/// SDAT の INFO と FAT（sdat_info.Sdat）
pub struct Sdat<'a> {
    pub s: &'a [u8],
    pub fat: Vec<(usize, usize)>,
    pub seqs: Vec<SeqInfo>,
    pub bank_names: Vec<Option<String>>,
    pub wavearc_names: Vec<Option<String>>,
    pub banks: BTreeMap<usize, (u16, [u16; 4])>,
    pub wavearcs: BTreeMap<usize, u16>,
    pub players: BTreeMap<usize, (u8, u16)>,
}

impl<'a> Sdat<'a> {
    pub fn new(s: &'a [u8]) -> Result<Self> {
        let (symb, info, fat_off) = header(s)?;
        let n = u32_at(s, fat_off + 8)? as usize;
        let mut fat = Vec::with_capacity(n);
        for i in 0..n {
            fat.push((u32_at(s, fat_off + 12 + 16 * i)? as usize, u32_at(s, fat_off + 16 + 16 * i)? as usize));
        }
        let snames = names(s, symb, 0)?;
        let mut seqs = Vec::new();
        for (i, off) in records(s, info, 0)? {
            let p = info + off;
            let name = match snames.get(i) {
                Some(Some(n)) if !n.is_empty() => n.clone(),
                _ => format!("SEQ_{i:03}"),
            };
            seqs.push(SeqInfo {
                index: i,
                name,
                file_id: u16_at(s, p)?,
                bank: u16_at(s, p + 4)?,
                volume: u8_at(s, p + 6)?,
                channel_prio: u8_at(s, p + 7)?,
                player_prio: u8_at(s, p + 8)?,
                player: u8_at(s, p + 9)?,
            });
        }
        let mut banks = BTreeMap::new();
        for (i, off) in records(s, info, 2)? {
            let p = info + off;
            let wa = [u16_at(s, p + 4)?, u16_at(s, p + 6)?, u16_at(s, p + 8)?, u16_at(s, p + 10)?];
            banks.insert(i, (u16_at(s, p)?, wa));
        }
        let mut wavearcs = BTreeMap::new();
        for (i, off) in records(s, info, 3)? {
            wavearcs.insert(i, u16_at(s, info + off)?);
        }
        let mut players = BTreeMap::new();
        for (i, off) in records(s, info, 4)? {
            players.insert(i, (u8_at(s, info + off)?, u16_at(s, info + off + 2)?));
        }
        Ok(Sdat {
            s,
            fat,
            seqs,
            bank_names: names(s, symb, 2)?,
            wavearc_names: names(s, symb, 3)?,
            banks,
            wavearcs,
            players,
        })
    }

    pub fn file(&self, fid: usize) -> &'a [u8] {
        let (off, size) = self.fat.get(fid).copied().unwrap_or((0, 0));
        crate::bytes::py_slice(self.s, off, off + size)
    }

    pub fn bank_name(&self, i: usize) -> String {
        match self.bank_names.get(i) {
            Some(Some(n)) if !n.is_empty() => n.clone(),
            _ => format!("bank_{i}"),
        }
    }

    pub fn wavearc_name(&self, i: usize) -> String {
        match self.wavearc_names.get(i) {
            Some(Some(n)) if !n.is_empty() => n.clone(),
            _ => format!("wavearc_{i}"),
        }
    }
}
