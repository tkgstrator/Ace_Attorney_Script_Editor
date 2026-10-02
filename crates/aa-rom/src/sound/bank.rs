//! SBNK（音色の表）と SWAR（波形の書庫）を読む（nds_sbnk_swar.py）。
//!
//! SWAV の見出し（12 バイト）: u8 形式（0 = PCM8、1 = PCM16、2 = IMA-ADPCM）, u8 ループ, u16 周波数,
//!   u16 タイマー, u16 ループ開始（4 バイト単位）, u32 ループ部分の長さ（4 バイト単位）
//! SBNK の音色: u8 種類, u16 位置, u8。1 = PCM、2 = PSG、3 = ノイズ、16 = ドラムセット、17 = 鍵盤分割

use super::tables::{ADPCM_INDEX, ADPCM_STEP};
use crate::bytes::{err, u16_at, u32_at, u8_at, Result};

/// PCM に直した波形とループ
#[derive(Debug, Clone)]
pub struct Wave {
    pub data: Vec<i16>,
    /// 1 サンプルの周期（チャンネルのクロック数）
    pub timer: i64,
    pub looped: bool,
    /// サンプル単位
    pub loop_start: i64,
    /// 鍵盤を押してから最初のサンプルが出るまでの遅れ（サンプル数）
    pub start_delay: i64,
}

/// DS の IMA-ADPCM（下位 4 ビットが先）を int16 に直す
pub fn decode_adpcm(body: &[u8]) -> Result<Vec<i16>> {
    if body.len() < 4 {
        return err("ADPCM が短い");
    }
    let mut pred = i16::from_le_bytes([body[0], body[1]]) as i32;
    let mut idx = (body[2] as i32).clamp(0, 88);
    let mut out = Vec::with_capacity((body.len() - 4) * 2);
    for &b in &body[4..] {
        for d in [b & 0xF, b >> 4] {
            let d = d as i32;
            let step = ADPCM_STEP[idx as usize];
            let mut diff = step >> 3;
            if d & 1 != 0 {
                diff += step >> 2;
            }
            if d & 2 != 0 {
                diff += step >> 1;
            }
            if d & 4 != 0 {
                diff += step;
            }
            pred = if d & 8 != 0 {
                (pred - diff).max(-0x7FFF)
            } else {
                (pred + diff).min(0x7FFF)
            };
            idx = (idx + ADPCM_INDEX[(d & 7) as usize]).clamp(0, 88);
            out.push(pred as i16);
        }
    }
    Ok(out)
}

pub fn parse_swav(body: &[u8]) -> Result<Wave> {
    let (fmt, looped, _rate, timer, loop_ofs, loop_len) = (
        u8_at(body, 0)?,
        u8_at(body, 1)?,
        u16_at(body, 2)?,
        u16_at(body, 4)?,
        u16_at(body, 6)? as usize,
        u32_at(body, 8)? as usize,
    );
    let raw = crate::bytes::py_slice(body, 12, 12 + (loop_ofs + loop_len) * 4);
    let (mut data, ls, delay): (Vec<i16>, usize, i64) = match fmt {
        0 => (
            raw.iter().map(|&b| (b as i8 as i16) << 8).collect(),
            loop_ofs * 4,
            3,
        ),
        1 => (
            raw.as_chunks::<2>()
                .0
                .iter()
                .map(|c| i16::from_le_bytes([c[0], c[1]]))
                .collect(),
            loop_ofs * 2,
            3,
        ),
        2 => (decode_adpcm(raw)?, loop_ofs.saturating_sub(1) * 8, 11),
        _ => return err(format!("不明な波形の形式 {fmt}")),
    };
    if data.is_empty() {
        data = vec![0];
    }
    let ls = ls.min(data.len() - 1) as i64;
    Ok(Wave {
        data,
        timer: timer as i64,
        looped: looped != 0,
        loop_start: ls,
        start_delay: delay,
    })
}

pub fn parse_swar(body: &[u8]) -> Result<Vec<Option<Wave>>> {
    if body.get(..4) != Some(b"SWAR") {
        return err("SWAR ではありません");
    }
    let n = u32_at(body, 0x38)? as usize;
    let offs: Vec<usize> = (0..n)
        .map(|i| u32_at(body, 0x3C + 4 * i).map(|v| v as usize))
        .collect::<Result<_>>()?;
    Ok(offs
        .iter()
        .enumerate()
        .map(|(i, &off)| {
            if off == 0 {
                return None;
            }
            let end = offs[i + 1..]
                .iter()
                .copied()
                .find(|&o| o > off)
                .unwrap_or(body.len());
            parse_swav(crate::bytes::py_slice(body, off, end)).ok()
        })
        .collect())
}

/// 1 つの鍵の範囲の音色
#[derive(Debug, Clone, Copy)]
pub struct Region {
    pub kind: i64,
    pub swav: i64,
    pub swar: i64,
    pub base_key: i64,
    pub attack: i64,
    pub decay: i64,
    pub sustain: i64,
    pub release: i64,
    pub pan: i64,
    pub low: i64,
    pub high: i64,
}

#[derive(Debug, Clone)]
pub struct Instrument {
    pub kind: u8,
    pub regions: Vec<Region>,
}

impl Instrument {
    /// 鍵 key で鳴らす範囲（SSEQPlayer の NoteOn と同じ選び方）
    pub fn region_for(&self, key: i64) -> Option<Region> {
        let first = self.regions.first()?;
        match self.kind {
            16 => {
                if !(first.low <= key && key <= self.regions.last()?.high) {
                    return None;
                }
                self.regions.get((key - first.low) as usize).copied()
            }
            17 => self.regions.iter().find(|r| key <= r.high).copied(),
            _ => Some(*first),
        }
    }
}

fn region(body: &[u8], off: usize, kind: i64, low: i64, high: i64) -> Result<Region> {
    if off + 10 > body.len() {
        return err("音色が範囲外");
    }
    let b = |k: usize| body[off + k] as i64;
    Ok(Region {
        kind,
        swav: u16_at(body, off)? as i64,
        swar: u16_at(body, off + 2)? as i64,
        base_key: b(4),
        attack: b(5),
        decay: b(6),
        sustain: b(7),
        release: b(8),
        pan: b(9),
        low,
        high,
    })
}

fn regions(body: &[u8], kind: u8, off: usize) -> Result<Vec<Region>> {
    let mut out = Vec::new();
    match kind {
        1..=5 => out.push(region(body, off, kind as i64, 0, 127)?),
        16 => {
            let (low, high) = (body[off] as i64, body[off + 1] as i64);
            let mut p = off + 2;
            for k in low..=high {
                let sub = u16_at(body, p)? as i64;
                out.push(region(body, p + 2, sub, k, k)?);
                p += 12;
            }
        }
        17 => {
            let highs = crate::bytes::py_slice(body, off, off + 8).to_vec();
            let (mut p, mut low) = (off + 8, 0i64);
            for h in highs {
                if h == 0 {
                    break;
                }
                let sub = u16_at(body, p)? as i64;
                out.push(region(body, p + 2, sub, low, h as i64)?);
                low = h as i64 + 1;
                p += 12;
            }
        }
        _ => {}
    }
    Ok(out)
}

pub fn parse_sbnk(body: &[u8]) -> Result<Vec<Instrument>> {
    if body.get(..4) != Some(b"SBNK") {
        return err("SBNK ではありません");
    }
    let n = u32_at(body, 0x38)? as usize;
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let kind = u8_at(body, 0x3C + 4 * i)?;
        let off = u16_at(body, 0x3D + 4 * i)? as usize;
        u8_at(body, 0x3F + 4 * i)?;
        // struct.error（範囲外）なら音色は空になる
        let regions = regions(body, kind, off).unwrap_or_default();
        out.push(Instrument { kind, regions });
    }
    Ok(out)
}
