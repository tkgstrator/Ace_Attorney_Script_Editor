//! SSEQ を DS の音源と同じ計算で鳴らす（sseq_render.py の render / loop_plan / choose_loop）。
//!
//! 継ぎ目の選び方は浮動小数点の和を比べるので、numpy の np.sum と同じ順番（pairwise summation）で足す。

use std::collections::BTreeMap;
use std::sync::Arc;

use super::bank::{parse_sbnk, parse_swar, Instrument, Wave};
use super::player::Player;
use super::sdat::{Sdat, SeqInfo};
use super::tables::OUTPUT_RATE_INT;
use crate::bytes::{err, Result};

/// 全体の音量（SND_SetMasterVolume(127)）
const MASTER: f64 = 127.0 / 128.0;
/// ループの継ぎ目を確かめるために loopEnd の後ろも作る長さ（秒）
const CHECK_SECONDS: f64 = 1.0;

/// numpy の pairwise summation（DOUBLE_pairwise_sum と同じ順番）。a(i) が i 番目の値
pub fn np_sum_by(n: usize, a: &dyn Fn(usize) -> f64) -> f64 {
    fn go(lo: usize, n: usize, a: &dyn Fn(usize) -> f64) -> f64 {
        if n < 8 {
            let mut res = 0.0;
            for i in 0..n {
                res += a(lo + i);
            }
            res
        } else if n <= 128 {
            let mut r = [0.0f64; 8];
            for (j, x) in r.iter_mut().enumerate() {
                *x = a(lo + j);
            }
            let mut i = 8;
            while i < n - n % 8 {
                for (j, x) in r.iter_mut().enumerate() {
                    *x += a(lo + i + j);
                }
                i += 8;
            }
            let mut res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
            while i < n {
                res += a(lo + i);
                i += 1;
            }
            res
        } else {
            let mut n2 = n / 2;
            n2 -= n2 % 8;
            go(lo, n2, a) + go(lo + n2, n - n2, a)
        }
    }
    go(0, n, a)
}

pub fn np_sum(a: &[f64]) -> f64 {
    np_sum_by(a.len(), &|i| a[i])
}

/// np.mean（空なら NaN）
pub fn np_mean(a: &[f64]) -> f64 {
    np_sum(a) / a.len() as f64
}

/// バンクと波形書庫（曲ごとに読み直さないように覚えておく）
#[derive(Default)]
pub struct Cache {
    banks: BTreeMap<usize, (Arc<Vec<Instrument>>, Vec<Arc<Vec<Option<Arc<Wave>>>>>, Vec<String>)>,
    swars: BTreeMap<usize, Arc<Vec<Option<Arc<Wave>>>>>,
}

impl Cache {
    fn load(&mut self, sdat: &Sdat, bank_id: usize) -> Result<(Arc<Vec<Instrument>>, Vec<Arc<Vec<Option<Arc<Wave>>>>>, Vec<String>)> {
        if let Some(b) = self.banks.get(&bank_id) {
            return Ok(b.clone());
        }
        let Some(&(fid, arcs)) = sdat.banks.get(&bank_id) else { return err(format!("バンク {bank_id} が無い")) };
        let bank = Arc::new(parse_sbnk(sdat.file(fid as usize))?);
        let mut waves = Vec::new();
        for wa in arcs {
            let wa = wa as usize;
            let Some(&fid) = sdat.wavearcs.get(&wa).filter(|_| wa != 0xFFFF) else {
                waves.push(Arc::new(Vec::new()));
                continue;
            };
            if let std::collections::btree_map::Entry::Vacant(e) = self.swars.entry(wa) {
                let w = parse_swar(sdat.file(fid as usize))?.into_iter().map(|x| x.map(Arc::new)).collect();
                e.insert(Arc::new(w));
            }
            waves.push(self.swars[&wa].clone());
        }
        let names = arcs.iter().filter(|&&w| w != 0xFFFF).map(|&w| sdat.wavearc_name(w as usize)).collect();
        let v = (bank, waves, names);
        self.banks.insert(bank_id, v.clone());
        Ok(v)
    }
}

/// フレーム f が始まる出力サンプルの位置（1 フレーム = 170.5 サンプル）
fn frame_start(f: i64) -> i64 {
    (f * 341) / 2
}

fn gcd(a: i64, b: i64) -> i64 {
    if b == 0 { a.abs() } else { gcd(b, a % b) }
}

/// ループの位置（ティック）を決める: (前奏 + ループ 2 回が終わるティック, ループの長さ, ループに入った最初のティック)
fn loop_plan(p: &Player, end_ticks: &BTreeMap<i64, i64>) -> Option<(i64, i64, i64)> {
    let (mut lengths, mut firsts, mut entries) = (vec![], vec![], vec![]);
    for t in &p.tracks {
        let Some(ev) = p.loops.get(&t.no).filter(|e| !e.is_empty()) else {
            if !t.end {
                return None; // まだ前奏の途中のトラックがある
            }
            continue;
        };
        if ev.len() < 2 {
            return None;
        }
        let ln = ev[1].0 - ev[0].0;
        if ln <= 0 {
            return None;
        }
        lengths.push(ln);
        firsts.push(ev[0].0);
        entries.push(ev[0].0 - ln);
    }
    if lengths.is_empty() {
        return None;
    }
    let mut length = 1i64;
    for x in lengths {
        length = length * x / gcd(length, x);
    }
    let ends = p.tracks.iter().filter(|t| !p.loops.contains_key(&t.no)).filter_map(|t| end_ticks.get(&t.no).copied());
    let kmin = entries.into_iter().chain(ends).max().unwrap();
    let mut start = firsts.into_iter().max().unwrap(); // 1 回目のループの終わり
    while start < kmin + length {
        start += length;
    }
    Some((start + length, length, kmin.max(start - length)))
}

/// 継ぎ目の選び方の結果
#[derive(Debug, Clone)]
pub struct Loop {
    pub start_tick: i64,
    pub end_tick: i64,
    pub start_sample: i64,
    pub end_sample: i64,
    pub end_shift: i64,
    pub seam_error: f64,
    pub file_end: i64,
    pub length_ticks: i64,
    pub tempo_phase: [i64; 2],
}

/// ループの始まりのティック k（kmin〜kmax）と終わりのずらし方を、継ぎ目の差が最も小さいものにする
fn choose_loop(left: &[f64], right: &[f64], tick_sample: &[i64], kmin: i64, kmax: i64, length: i64) -> Option<(i64, i64, i64, i64, f64)> {
    const WIN: usize = 655;
    let mono = |i: usize| left[i] + right[i];
    let n = left.len();
    let g0 = (np_sum_by(n, &|i| mono(i) * mono(i)) / n as f64).sqrt();
    let g = if g0 != 0.0 { g0 } else { 1.0 };
    let mut best: Option<(f64, i64, i64, i64, i64)> = None;
    let mut buf = vec![0.0f64; WIN];
    for k in kmin..=kmax {
        let (ls, le0) = (tick_sample[k as usize], tick_sample[(k + length) as usize]);
        if le0 + 171 + WIN as i64 > n as i64 {
            break;
        }
        let ls_ = ls as usize;
        for d in [0i64, -1, 1, -170, -171, 170, 171] {
            let s = (le0 + d) as usize;
            for (j, v) in buf.iter_mut().enumerate() {
                let x = mono(ls_ + j) - mono(s + j);
                *v = x * x;
            }
            let e = np_sum(&buf);
            if best.is_none_or(|b| e < b.0) {
                best = Some((e, k, ls, le0 + d, d));
            }
        }
    }
    let (e, k, ls, le, d) = best?;
    Some((k, ls, le, d, (e / WIN as f64).sqrt() / g))
}

/// 曲の書き出しに要るもの
pub struct Rendered {
    /// 左右のサンプル（1.0 = 32768 の 1 段）
    pub left: Vec<f64>,
    pub right: Vec<f64>,
    pub loop_: Option<Loop>,
    pub finished: bool,
    pub capped: bool,
    pub bank_name: String,
    pub wave_archives: Vec<String>,
    pub tracks: usize,
    pub missing_waves: Vec<String>,
    pub uses_random: bool,
}

pub fn render(sdat: &Sdat, info: &SeqInfo, max_seconds: f64, cache: &mut Cache) -> Result<Rendered> {
    let (bank, waves, arc_names) = cache.load(sdat, info.bank as usize)?;
    let mask = sdat.players.get(&(info.player as usize)).map_or(0, |p| p.1 as i64);
    let mut p = Player::new(sdat.file(info.file_id as usize), bank, waves, info.volume as i64, info.channel_prio as i64, mask)?;
    let (mut left, mut right): (Vec<f64>, Vec<f64>) = (Vec::new(), Vec::new());
    let mut end_ticks: BTreeMap<i64, i64> = BTreeMap::new();
    let mut plan = None;
    let max_frames = (max_seconds * OUTPUT_RATE_INT as f64 / 170.5) as i64;
    let check_frames = (CHECK_SECONDS * OUTPUT_RATE_INT as f64 / 170.5) as i64;
    let mut stop_frame: Option<i64> = None;
    while p.frame_no < max_frames {
        let f = p.frame_no;
        p.frame();
        for t in &p.tracks {
            if t.end && !end_ticks.contains_key(&t.no) {
                end_ticks.insert(t.no, p.tick_no);
            }
        }
        let n = (frame_start(f + 1) - frame_start(f)) as usize;
        let at = left.len();
        left.resize(at + n, 0.0);
        right.resize(at + n, 0.0);
        for ch in &mut p.channels {
            ch.render(n, &mut left[at..], &mut right[at..]);
        }
        if p.finished() {
            break;
        }
        if plan.is_none() && !p.loops.is_empty() && f % 32 == 0 {
            plan = loop_plan(&p, &end_ticks);
        }
        if let (Some(pl), None) = (plan, stop_frame) {
            if p.tick_no > pl.0 {
                stop_frame = Some(p.frame_no + check_frames);
            }
        }
        if stop_frame.is_some_and(|s| p.frame_no >= s) {
            break;
        }
    }
    for x in left.iter_mut().chain(right.iter_mut()) {
        *x *= MASTER;
    }
    let mut loop_ = None;
    if let Some((end, length, kmin)) = plan.filter(|pl| (pl.0 as usize) < p.tick_frames.len()) {
        // ティックを実行したフレームの次のフレームから音が変わる
        let tick_sample: Vec<i64> = p.tick_frames.iter().map(|&f| frame_start(f + 1)).collect();
        if let Some((k, ls, le, d, seam)) = choose_loop(&left, &right, &tick_sample, kmin, end - length, length) {
            loop_ = Some(Loop {
                start_tick: k,
                end_tick: k + length,
                start_sample: ls,
                end_sample: le,
                end_shift: d,
                seam_error: seam,
                file_end: tick_sample[end as usize],
                length_ticks: length,
                tempo_phase: [p.tick_phase[k as usize], p.tick_phase[(k + length) as usize]],
            });
        }
    }
    let finished = p.finished();
    Ok(Rendered {
        left,
        right,
        loop_,
        finished,
        capped: p.frame_no >= max_frames && !finished,
        bank_name: sdat.bank_name(info.bank as usize),
        wave_archives: arc_names,
        tracks: p.tracks.len(),
        missing_waves: p.missing.iter().cloned().collect(),
        uses_random: p.used_random,
    })
}
