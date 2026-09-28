//! SSEQ のトラック（1 本の命令の列）（sseq_track.py）。
//!
//! 乱数（A0）・変数（A1）・条件（A2）は、次の命令の最後の引数を置き換える / 次の命令を飛ばす。
//! 乱数は SDK と同じ線形合同法だが、実機の種は分からないので、乱数を使う曲は実機と同じにはならない。

use super::channel::{TrackView, NONE};
use super::player::Player;
use super::tables::cnv_sust;

/// 引数の種類: b = u8, s = s8, h = s16, H = u16, t = u24, v = 可変長。None = 知らない命令
fn args_of(cmd: u8) -> Option<&'static str> {
    Some(match cmd {
        0x80 | 0x81 => "v",
        0x93 => "bt",
        0x94 | 0x95 => "t",
        0xC3 | 0xC4 => "s",
        0xE0 | 0xE1 => "H",
        0xE3 => "h",
        0xFC | 0xFD | 0xFF => "",
        0xFE => "H",
        0xB0..=0xBD => "bh",
        0xC0..=0xD6 => "b",
        _ => return None,
    })
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Plain,
    Rand,
    Var,
}

#[derive(Clone)]
pub struct Track {
    pub no: i64,
    pub pos: usize,
    /// (戻る位置, ループの残り回数 または -1 = call)
    pub stack: Vec<(usize, i64)>,
    pub wait: i64,
    pub end: bool,
    pub patch: i64,
    pub pan: i64,
    pub vol: i64,
    pub expr: i64,
    pub bend: i64,
    pub bend_range: i64,
    pub transpose: i64,
    pub prio: i64,
    pub note_wait: bool,
    pub tie: bool,
    pub tie_channel: Option<usize>,
    pub porta: bool,
    pub porta_key: i64,
    pub porta_time: i64,
    pub sweep_pitch: i64,
    pub a: i64,
    pub d: i64,
    pub s: i64,
    pub r: i64,
    pub mod_type: i64,
    pub mod_speed: i64,
    pub mod_depth: i64,
    pub mod_range: i64,
    pub mod_delay: i64,
    pub cond: bool,
}

impl Track {
    pub fn new(player_prio: i64, no: i64, pos: usize) -> Self {
        Track {
            no, pos, stack: vec![], wait: 0, end: false, patch: 0, pan: 0, vol: 127, expr: 127, bend: 0, bend_range: 2,
            transpose: 0, prio: player_prio + 64, note_wait: true, tie: false, tie_channel: None, porta: false,
            porta_key: 60, porta_time: 0, sweep_pitch: 0, a: 0xFF, d: 0xFF, s: 0xFF, r: 0xFF, mod_type: 0,
            mod_speed: 16, mod_depth: 0, mod_range: 1, mod_delay: 0, cond: true,
        }
    }

    pub fn view(&self) -> TrackView {
        TrackView {
            vol: self.vol, expr: self.expr, pan: self.pan, bend: self.bend, bend_range: self.bend_range,
            mod_type: self.mod_type, mod_speed: self.mod_speed, mod_depth: self.mod_depth, mod_range: self.mod_range,
            mod_delay: self.mod_delay, sweep_pitch: self.sweep_pitch, porta: self.porta, porta_key: self.porta_key,
            porta_time: self.porta_time,
        }
    }
}

impl Player {
    fn u8(&mut self, t: usize) -> i64 {
        let p = self.tracks[t].pos;
        self.tracks[t].pos += 1;
        self.data[p] as i64
    }

    fn arg(&mut self, t: usize, ty: u8) -> i64 {
        match ty {
            b'b' => self.u8(t),
            b's' => {
                let v = self.u8(t);
                if v >= 128 { v - 256 } else { v }
            }
            b'h' | b'H' => {
                let v = self.u8(t) | self.u8(t) << 8;
                if ty == b'h' && v >= 0x8000 { v - 0x10000 } else { v }
            }
            b't' => self.u8(t) | self.u8(t) << 8 | self.u8(t) << 16,
            _ => {
                let mut v = 0i64;
                loop {
                    let b = self.u8(t);
                    v = (v << 7) | (b & 0x7F);
                    if b & 0x80 == 0 {
                        return v;
                    }
                }
            }
        }
    }

    /// 引数を読む。mode が Rand / Var なら最後の引数を乱数 / 変数に置き換える
    fn args(&mut self, t: usize, types: &str, mode: Mode) -> Vec<i64> {
        let b = types.as_bytes();
        let mut out: Vec<i64> = Vec::with_capacity(b.len());
        if b.is_empty() {
            return out;
        }
        for &ty in &b[..b.len() - 1] {
            let v = self.arg(t, ty);
            out.push(v);
        }
        let last = match mode {
            Mode::Rand => {
                let (lo, hi) = (self.arg(t, b'h'), self.arg(t, b'h'));
                lo + ((self.random() * (hi - lo + 1)) >> 16)
            }
            Mode::Var => {
                let i = self.u8(t);
                self.var_get(i)
            }
            Mode::Plain => self.arg(t, b[b.len() - 1]),
        };
        out.push(last);
        out
    }

    /// 1 ティック
    pub fn track_tick(&mut self, t: usize) {
        if self.tracks[t].end {
            return;
        }
        if self.tracks[t].wait > 0 {
            self.tracks[t].wait -= 1;
            if self.tracks[t].wait > 0 {
                return;
            }
        }
        let mut guard = 0;
        while self.tracks[t].wait == 0 && !self.tracks[t].end {
            guard += 1;
            if guard > 10000 {
                self.finish(t); // 待たずに回り続ける列（壊れたデータ）
                return;
            }
            self.step(t, Mode::Plain, false);
        }
    }

    fn step(&mut self, t: usize, mode: Mode, skip: bool) {
        let cmd = self.u8(t) as u8;
        match cmd {
            0xA0 => return self.step(t, Mode::Rand, skip),
            0xA1 => return self.step(t, Mode::Var, skip),
            0xA2 => {
                let c = self.tracks[t].cond;
                return self.step(t, mode, skip || !c);
            }
            _ => {}
        }
        if cmd < 0x80 {
            let a = self.args(t, "bv", mode);
            if !skip {
                self.note(t, cmd as i64, a[0], a[1]);
            }
            return;
        }
        let Some(types) = args_of(cmd) else {
            self.finish(t); // 知らない命令: 止める
            return;
        };
        let a = self.args(t, types, mode);
        if !skip {
            self.execute(t, cmd, &a);
        }
    }

    fn execute(&mut self, t: usize, cmd: u8, a: &[i64]) {
        let (base, prio) = (self.base, self.prio);
        let tr = &mut self.tracks[t];
        match cmd {
            0x80 => tr.wait = a[0],
            0x81 => tr.patch = a[0],
            0x93 => self.open_track(a[0], a[1]),
            0x94 => {
                let target = base + a[0] as usize;
                if target <= tr.pos {
                    self.loop_event(t, target);
                }
                self.tracks[t].pos = target;
            }
            0x95 => {
                tr.stack.push((tr.pos, -1));
                tr.pos = base + a[0] as usize;
            }
            0xFD => {
                if let Some((p, _)) = tr.stack.pop() {
                    tr.pos = p;
                }
            }
            0xD4 => tr.stack.push((tr.pos, a[0])),
            0xFC => {
                if let Some(&(ret, cnt)) = tr.stack.last() {
                    if cnt == 0 {
                        // 回数 0 = 無限
                        self.loop_event(t, ret);
                        self.tracks[t].pos = ret;
                    } else if cnt > 1 {
                        *tr.stack.last_mut().unwrap() = (ret, cnt - 1);
                        tr.pos = ret;
                    } else {
                        tr.stack.pop();
                    }
                }
            }
            0xFF => self.finish(t),
            0xFE => {}
            0xB0..=0xBD => self.var_op(t, cmd, a[0], a[1]),
            0xC0 => tr.pan = a[0] - 64,
            0xC1 => tr.vol = a[0],
            0xC2 => self.master_vol = cnv_sust(a[0]),
            0xC3 => tr.transpose = a[0],
            0xC4 => tr.bend = a[0],
            0xC5 => tr.bend_range = a[0],
            0xC6 => tr.prio = prio + a[0],
            0xC7 => tr.note_wait = a[0] != 0,
            0xC8 => {
                tr.tie = a[0] != 0;
                self.release_track(t);
                self.tracks[t].tie_channel = None;
            }
            0xC9 => {
                tr.porta_key = a[0] + tr.transpose;
                tr.porta = true;
            }
            0xCA => tr.mod_depth = a[0],
            0xCB => tr.mod_speed = a[0],
            0xCC => tr.mod_type = a[0],
            0xCD => tr.mod_range = a[0],
            0xCE => tr.porta = a[0] != 0,
            0xCF => tr.porta_time = a[0],
            0xD0 => tr.a = a[0],
            0xD1 => tr.d = a[0],
            0xD2 => tr.s = a[0],
            0xD3 => tr.r = a[0],
            0xD5 => tr.expr = a[0],
            0xE0 => tr.mod_delay = a[0],
            0xE1 => self.tempo = a[0],
            0xE3 => tr.sweep_pitch = a[0],
            _ => {}
        }
    }

    pub fn finish(&mut self, t: usize) {
        self.tracks[t].end = true;
        self.release_track(t);
    }

    fn var_op(&mut self, t: usize, cmd: u8, idx: i64, val: i64) {
        let cur = self.var_get(idx);
        match cmd {
            0xB0 => self.var_set(idx, val),
            0xB1 => self.var_set(idx, cur + val),
            0xB2 => self.var_set(idx, cur - val),
            0xB3 => self.var_set(idx, cur * val),
            0xB4 => {
                if val != 0 {
                    self.var_set(idx, cur / val);
                }
            }
            0xB5 => {
                let v = if val >= 0 {
                    if val < 48 { cur << val } else { 0 }
                } else if -val < 64 {
                    cur >> -val
                } else if cur < 0 {
                    -1
                } else {
                    0
                };
                self.var_set(idx, v);
            }
            0xB6 => {
                let r = (self.random() * (val.abs() + 1)) >> 16;
                self.var_set(idx, if val < 0 { -r } else { r });
            }
            0xB8..=0xBD => {
                self.tracks[t].cond = match cmd {
                    0xB8 => cur == val,
                    0xB9 => cur >= val,
                    0xBA => cur > val,
                    0xBB => cur <= val,
                    0xBC => cur < val,
                    _ => cur != val,
                };
            }
            _ => {}
        }
    }

    fn note(&mut self, t: usize, key: i64, vel: i64, length: i64) {
        let key = (key + self.tracks[t].transpose).clamp(0, 127);
        if self.tracks[t].tie {
            let ch = self.tracks[t].tie_channel;
            let alive = ch.is_some_and(|c| self.channels[c].state != NONE && self.channels[c].track == Some(t));
            if alive {
                let c = ch.unwrap();
                let view = self.tracks[t].view();
                let (mv, sv) = (self.master_vol, self.seq_vol);
                let chn = &mut self.channels[c];
                chn.key = key;
                chn.velocity = cnv_sust(vel);
                chn.update_from_track(&view, mv, sv);
                chn.start_porta(&view);
            } else {
                self.tracks[t].tie_channel = self.note_on(t, key, vel, -1);
            }
        } else {
            self.note_on(t, key, vel, length);
        }
        self.tracks[t].porta_key = key;
        if self.tracks[t].note_wait {
            self.tracks[t].wait = length;
        }
    }
}
