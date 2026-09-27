//! SSEQ の演奏（音源ドライバーの Player と Track）（sseq_player.py）。
//!
//! 1 フレームごとに: 各チャンネルにトラックの音量などを写す → チャンネルを進める →
//! テンポのカウンターに テンポ × 256 / 256 を足し、240 を超えるたびに 1 ティック進める。

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use super::bank::{Instrument, Wave};
use super::channel::{Channel, NOISE, NONE, PCM, PSG, PSG_BASE_TIMER, START};
use super::tables::{cnv_attack, cnv_fall, cnv_sust};
use super::track::Track;
use crate::bytes::{err, Result};

/// 空いているチャンネルを探す順番（SSEQPlayer の ChannelAlloc と同じ）
const PCM_ORDER: [usize; 16] = [4, 5, 6, 7, 2, 0, 3, 1, 8, 9, 10, 11, 14, 12, 15, 13];
const PSG_ORDER: [usize; 6] = [8, 9, 10, 11, 12, 13];
const NOISE_ORDER: [usize; 2] = [14, 15];

pub struct Player {
    pub data: Vec<u8>,
    pub base: usize,
    pub bank: Arc<Vec<Instrument>>,
    pub waves: Vec<Arc<Vec<Option<Arc<Wave>>>>>,
    pub seq_vol: i64,
    pub master_vol: i64,
    pub prio: i64,
    pub mask: i64,
    pub tempo: i64,
    pub tempo_rate: i64,
    pub tempo_count: i64,
    pub vars: [i64; 32],
    pub seed: i64,
    /// 乱数を使った（実機と同じ音にはならない）
    pub used_random: bool,
    pub channels: Vec<Channel>,
    pub tracks: Vec<Track>,
    pub tick_no: i64,
    pub frame_no: i64,
    /// ティック → そのティックを実行したフレーム
    pub tick_frames: Vec<i64>,
    /// ティック → そのときのテンポのカウンターの端数
    pub tick_phase: Vec<i64>,
    /// トラック番号 → [(ティック, 先)]
    pub loops: BTreeMap<i64, Vec<(i64, usize)>>,
    pub missing: BTreeSet<String>,
}

impl Player {
    pub fn new(sseq: &[u8], bank: Arc<Vec<Instrument>>, waves: Vec<Arc<Vec<Option<Arc<Wave>>>>>, seq_vol: i64, prio: i64, channel_mask: i64) -> Result<Self> {
        if sseq.get(..4) != Some(b"SSEQ") {
            return err("SSEQ ではありません");
        }
        let base = crate::bytes::u32_at(sseq, 0x18)? as usize;
        Ok(Player {
            data: sseq.to_vec(),
            base,
            bank,
            waves,
            seq_vol: cnv_sust(seq_vol),
            master_vol: 0,
            prio,
            mask: if channel_mask != 0 { channel_mask } else { 0xFFFF },
            tempo: 120,
            tempo_rate: 256,
            tempo_count: 0,
            vars: [-1; 32],
            seed: 0x12345678,
            used_random: false,
            channels: (0..16).map(|_| Channel::new()).collect(),
            tracks: vec![Track::new(prio, 0, base)],
            tick_no: 0,
            frame_no: 0,
            tick_frames: Vec::new(),
            tick_phase: Vec::new(),
            loops: BTreeMap::new(),
            missing: BTreeSet::new(),
        })
    }

    pub fn random(&mut self) -> i64 {
        self.used_random = true;
        self.seed = (self.seed * 1664525 + 1013904223) & 0xFFFF_FFFF;
        self.seed >> 16
    }

    pub fn var_get(&self, i: i64) -> i64 {
        self.vars[(i & 31) as usize]
    }

    pub fn var_set(&mut self, i: i64, v: i64) {
        let v = v & 0xFFFF;
        self.vars[(i & 31) as usize] = if v >= 0x8000 { v - 0x10000 } else { v };
    }

    pub fn open_track(&mut self, no: i64, ofs: i64) {
        if self.tracks.len() >= 16 {
            return;
        }
        let t = Track::new(self.prio, no, self.base + ofs as usize);
        self.tracks.push(t);
    }

    pub fn loop_event(&mut self, t: usize, target: usize) {
        let no = self.tracks[t].no;
        self.loops.entry(no).or_default().push((self.tick_no, target));
    }

    pub fn release_track(&mut self, t: usize) {
        for ch in &mut self.channels {
            if ch.track == Some(t) && ch.state != NONE {
                ch.do_release();
            }
        }
    }

    pub fn finished(&self) -> bool {
        self.tracks.iter().all(|t| t.end) && self.channels.iter().all(|c| c.state == NONE)
    }

    fn alloc(&mut self, kind: i64, prio: i64) -> Option<usize> {
        let order: &[usize] = match kind {
            PCM => &PCM_ORDER,
            PSG => &PSG_ORDER,
            _ => &NOISE_ORDER,
        };
        let mut cur: Option<usize> = None;
        for &no in order {
            if self.mask & (1 << no) == 0 {
                continue;
            }
            let c = &self.channels[no];
            if let Some(k) = cur {
                let cc = &self.channels[k];
                if c.prio >= cc.prio && (c.prio != cc.prio || cc.amplitude() <= c.amplitude()) {
                    continue;
                }
            }
            cur = Some(no);
        }
        let k = cur?;
        if prio < self.channels[k].prio {
            return None;
        }
        self.channels[k].kill();
        Some(k)
    }

    pub fn note_on(&mut self, t: usize, key: i64, vel: i64, length: i64) -> Option<usize> {
        let tr = &self.tracks[t];
        // Python の list[i] と同じく、負の番号は後ろから数える
        let pi = if tr.patch < 0 { self.bank.len() as i64 + tr.patch } else { tr.patch };
        let inst = self.bank.get(usize::try_from(pi).ok()?)?;
        let reg = inst.region_for(key)?;
        if ![PCM, PSG, NOISE].contains(&reg.kind) {
            return None;
        }
        let mut wave = None;
        if reg.kind == PCM {
            let arc = self.waves.get(reg.swar as usize);
            wave = arc.and_then(|a| a.get(reg.swav as usize).cloned().flatten());
            if wave.is_none() {
                self.missing.insert(format!("swar{}/swav{}", reg.swar, reg.swav));
                return None;
            }
        }
        let tprio = tr.prio;
        let (ta, td, ts, trr) = (tr.a, tr.d, tr.s, tr.r);
        let view = tr.view();
        let c = self.alloc(reg.kind, tprio)?;
        let (mv, sv) = (self.master_vol, self.seq_vol);
        let ch = &mut self.channels[c];
        ch.kind = reg.kind;
        ch.base_timer = wave.as_ref().map_or(PSG_BASE_TIMER, |w| w.timer);
        ch.wave = wave;
        ch.duty = reg.swav;
        ch.state = START;
        ch.track = Some(t);
        ch.prio = tprio;
        ch.key = key;
        ch.org_key = reg.base_key;
        ch.velocity = cnv_sust(vel);
        ch.pan = reg.pan - 64;
        ch.mod_delay_cnt = 0;
        ch.mod_counter = 0;
        ch.note_length = length;
        ch.started_tick = true;
        ch.ended = false;
        ch.attack = cnv_attack(if ta == 0xFF { reg.attack } else { ta });
        ch.decay = cnv_fall(if td == 0xFF { reg.decay } else { td });
        ch.sustain = if ts == 0xFF { reg.sustain } else { ts };
        ch.release = cnv_fall(if trr == 0xFF { reg.release } else { trr });
        ch.update_from_track(&view, mv, sv);
        ch.start_porta(&view);
        Some(c)
    }

    fn run_tick(&mut self) {
        self.tick_frames.push(self.frame_no);
        self.tick_phase.push(self.tempo_count);
        for ch in &mut self.channels {
            if ch.state == NONE || ch.track.is_none() || ch.started_tick {
                continue;
            }
            if ch.state != START && ch.note_length > 0 {
                ch.note_length -= 1;
                if ch.note_length == 0 && ch.state < 5 {
                    ch.do_release();
                }
            }
            if ch.manual_sweep && ch.sweep_cnt < ch.sweep_len {
                ch.sweep_cnt += 1;
            }
        }
        let mut i = 0;
        while i < self.tracks.len() {
            // 開いたばかりのトラックも同じティックで動く
            self.track_tick(i);
            i += 1;
        }
        for ch in &mut self.channels {
            ch.started_tick = false;
        }
        self.tick_no += 1;
    }

    /// 1 フレーム分の音源ドライバーの処理
    pub fn frame(&mut self) {
        let (mv, sv) = (self.master_vol, self.seq_vol);
        for k in 0..self.channels.len() {
            let ch = &self.channels[k];
            if ch.state != NONE {
                if let Some(t) = ch.track {
                    let view = self.tracks[t].view();
                    self.channels[k].update_from_track(&view, mv, sv);
                }
            }
            self.channels[k].update();
        }
        self.tempo_count += (self.tempo * self.tempo_rate) >> 8;
        while self.tempo_count >= 240 {
            self.tempo_count -= 240;
            self.run_tick();
        }
        self.frame_no += 1;
    }
}
