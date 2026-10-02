//! DS の音源の 1 チャンネル分（音源ドライバーの ExChannel + ハードウェアのチャンネル）（sseq_channel.py）。
//!
//! 1 フレーム（約 5.2 ms）ごとに update() で包絡線・LFO・ポルタメントを進めてレジスターを決め、
//! render() でそのフレームのサンプルを作る。ハードウェアは補間をしないので、整数の計算で拾う。
//! 足し合わせは浮動小数点だが、値はすべて 2^-18 の倍数で 2^37 未満に収まるので、誤差なく Python 版と一致する。

use std::sync::{Arc, OnceLock};

use super::bank::Wave;
use super::tables::{
    cnv_sine, cnv_sust, register_amplitude, timer_adjust, volume_gain, AMPL_K, AMPL_THRESHOLD,
};

pub const NONE: u8 = 0;
pub const START: u8 = 1;
pub const ATTACK: u8 = 2;
pub const DECAY: u8 = 3;
pub const SUSTAIN: u8 = 4;
pub const RELEASE: u8 = 5;

pub const PCM: i64 = 1;
pub const PSG: i64 = 2;
pub const NOISE: i64 = 3;
/// NCSFCommon/Channel.cs の StartPSG・StartNoise と同じキー60のタイマー。
pub const PSG_BASE_TIMER: i64 = 8006;

/// ノイズのチャンネルの 15 ビット LFSR の出力（周期 32767）
fn noise_seq() -> &'static [i16] {
    static CELL: OnceLock<Vec<i16>> = OnceLock::new();
    CELL.get_or_init(|| {
        let mut x: u32 = 0x7FFF;
        (0..32767)
            .map(|_| {
                if x & 1 != 0 {
                    x = (x >> 1) ^ 0x6000;
                    -0x7FFF
                } else {
                    x >>= 1;
                    0x7FFF
                }
            })
            .collect()
    })
}

/// 矩形波: デューティ d（0〜6）は 8 段のうち d+1 段が高い。7 は常に低い
fn square(d: usize, i: usize) -> i16 {
    if i >= 7 - d.min(7) && d < 7 {
        0x7FFF
    } else {
        -0x7FFF
    }
}

/// トラックからチャンネルに写す値
pub struct TrackView {
    pub vol: i64,
    pub expr: i64,
    pub pan: i64,
    pub bend: i64,
    pub bend_range: i64,
    pub mod_type: i64,
    pub mod_speed: i64,
    pub mod_depth: i64,
    pub mod_range: i64,
    pub mod_delay: i64,
    pub sweep_pitch: i64,
    pub porta: bool,
    pub porta_key: i64,
    pub porta_time: i64,
}

#[derive(Clone, Default)]
pub struct Channel {
    pub state: u8,
    pub prio: i64,
    pub track: Option<usize>,
    pub key: i64,
    pub org_key: i64,
    pub velocity: i64,
    pub pan: i64,
    pub ext_ampl: i64,
    pub ext_pan: i64,
    pub ext_tune: i64,
    pub attack: i64,
    pub decay: i64,
    pub sustain: i64,
    pub release: i64,
    pub ampl: i64,
    pub mod_type: i64,
    pub mod_speed: i64,
    pub mod_depth: i64,
    pub mod_range: i64,
    pub mod_delay: i64,
    pub mod_delay_cnt: i64,
    pub mod_counter: i64,
    pub sweep_pitch: i64,
    pub sweep_len: i64,
    pub sweep_cnt: i64,
    pub manual_sweep: bool,
    pub note_length: i64,
    pub started_tick: bool,
    pub kind: i64,
    pub wave: Option<Arc<Wave>>,
    pub duty: i64,
    pub base_timer: i64,
    pub hw_on: bool,
    pub hw_vol: i64,
    pub hw_div: i64,
    pub hw_pan: i64,
    pub hw_timer: i64,
    pub pos: i64,
    pub acc: i64,
    pub ended: bool,
}

impl Channel {
    pub fn new() -> Self {
        Channel {
            key: 60,
            org_key: 60,
            ampl: AMPL_THRESHOLD,
            note_length: -1,
            kind: PCM,
            hw_pan: 64,
            hw_timer: 0x10,
            ..Default::default()
        }
    }

    /// チャンネルを奪うときの比べ方に使う音量
    pub fn amplitude(&self) -> f64 {
        if self.state != NONE {
            register_amplitude(self.hw_vol, self.hw_div)
        } else {
            0.0
        }
    }

    pub fn kill(&mut self) {
        self.state = NONE;
        self.prio = 0;
        self.track = None;
        self.hw_on = false;
        self.hw_vol = 0;
    }

    pub fn do_release(&mut self) {
        if self.state != NONE {
            self.state = RELEASE;
            self.prio = 1;
        }
    }

    /// トラックの音量・パン・音程・LFO をチャンネルに写す
    pub fn update_from_track(&mut self, t: &TrackView, master_vol: i64, seq_vol: i64) {
        // NCSFCommon/Track.cs の UpdateChannel はリリース中の値を保つ。
        if self.state == RELEASE {
            return;
        }
        let v = master_vol + seq_vol + cnv_sust(t.vol) + cnv_sust(t.expr);
        self.ext_ampl = v.max(-0x8000);
        self.ext_pan = t.pan;
        self.ext_tune = (self.key - self.org_key) * 64 + ((t.bend * t.bend_range) >> 1);
        self.mod_type = t.mod_type;
        self.mod_speed = t.mod_speed;
        self.mod_depth = t.mod_depth;
        self.mod_range = t.mod_range;
        self.mod_delay = t.mod_delay;
    }

    /// ポルタメント・スイープの設定
    pub fn start_porta(&mut self, t: &TrackView) {
        self.manual_sweep = false;
        self.sweep_pitch = t.sweep_pitch;
        self.sweep_cnt = 0;
        if !t.porta {
            self.sweep_len = 0;
            return;
        }
        let diff = (t.porta_key - self.key) << 22;
        self.sweep_pitch += diff >> 16;
        if t.porta_time == 0 {
            self.sweep_len = self.note_length;
            self.manual_sweep = true;
        } else {
            self.sweep_len = (self.sweep_pitch.abs() * t.porta_time * t.porta_time) >> 11;
        }
    }

    /// 1 フレーム進める
    pub fn update(&mut self) {
        if self.state == NONE {
            return;
        }
        if self.ended {
            self.kill();
            return;
        }
        if self.state == START {
            self.hw_on = true;
            // NCSFCommon/Channel.cs の StartPSG・StartNoise は1段待って開始する。
            self.pos = -(if self.kind == PCM {
                self.wave.as_ref().map_or(0, |w| w.start_delay)
            } else {
                1
            });
            self.acc = 0;
            self.ampl = AMPL_THRESHOLD;
            self.state = ATTACK;
        }
        if self.state == ATTACK {
            self.ampl = self.attack * self.ampl / 255; // C の整数の割り算（0 の方へ切り捨て）
            if self.ampl == 0 {
                self.state = DECAY;
            }
        } else if self.state == DECAY {
            self.ampl -= self.decay;
            let sus = cnv_sust(self.sustain) << 7;
            if self.ampl <= sus {
                self.ampl = sus;
                self.state = SUSTAIN;
            }
        } else if self.state == RELEASE {
            self.ampl -= self.release;
            if self.ampl <= AMPL_THRESHOLD {
                self.kill();
                return;
            }
        }
        let mut modulate = self.mod_depth != 0;
        let mut m = 0i64;
        if modulate && self.mod_delay_cnt < self.mod_delay {
            self.mod_delay_cnt += 1;
            modulate = false;
        }
        if modulate {
            m = cnv_sine(self.mod_counter >> 8) * self.mod_range * self.mod_depth;
            m = if self.mod_type == 1 {
                (m * 60) >> 14
            } else {
                m >> 8
            };
            self.mod_counter = (self.mod_counter + (self.mod_speed << 6)) & 0x7FFF;
        }
        // 音程（タイマー）
        let mut adj = self.ext_tune;
        if self.mod_type == 0 {
            adj += m;
        }
        if self.sweep_pitch != 0 && self.sweep_len != 0 && self.sweep_cnt <= self.sweep_len {
            let n = self.sweep_pitch * (self.sweep_len - self.sweep_cnt);
            adj += n / self.sweep_len; // C と同じく 0 の方へ切り捨て
            if !self.manual_sweep {
                self.sweep_cnt += 1;
            }
        }
        let mut tmr = self.base_timer;
        if adj != 0 {
            tmr = timer_adjust(tmr, adj);
        }
        self.hw_timer = tmr.max(0x10);
        // 音量
        let mut total = (self.ampl >> 7) + self.ext_ampl + self.velocity;
        if self.mod_type == 1 {
            total += m;
        }
        (self.hw_vol, self.hw_div) = volume_gain(total);
        if total + AMPL_K <= 0 {
            (self.hw_vol, self.hw_div) = (0, 0);
        }
        // パン
        let mut pan = self.pan + self.ext_pan;
        if self.mod_type == 2 {
            pan += m;
        }
        self.hw_pan = (pan + 64).clamp(0, 127);
    }

    /// n サンプル分を作って out_l / out_r に足す
    pub fn render(&mut self, n: usize, out_l: &mut [f64], out_r: &mut [f64]) {
        if !self.hw_on || n == 0 {
            return;
        }
        let count = self.hw_timer;
        let (pos0, acc0) = (self.pos, self.acc);
        let total = self.acc + 512 * n as i64;
        self.pos += total / count;
        self.acc = total % count;
        if self.hw_vol == 0 {
            // 音は出ないが位置は進める（波形の終わりも調べる）
            if let (PCM, Some(w)) = (self.kind, &self.wave) {
                if !w.looped && self.pos >= w.data.len() as i64 {
                    self.ended = true;
                    self.hw_on = false;
                }
            }
            return;
        }
        let g = register_amplitude(self.hw_vol, self.hw_div);
        let (gl, gr) = (
            (128 - self.hw_pan) as f64 / 128.0,
            self.hw_pan as f64 / 128.0,
        );
        let idx = |j: usize| pos0 + (acc0 + 512 * j as i64) / count;
        let mut put = |j: usize, s: i16| {
            let x = s as f64 * g;
            out_l[j] += x * gl;
            out_r[j] += x * gr;
        };
        match self.kind {
            PCM => {
                let w = self.wave.clone().expect("PCM の波形");
                let ln = w.data.len() as i64;
                for j in 0..n {
                    let mut i = idx(j);
                    if w.looped && i >= ln {
                        let ll = (ln - w.loop_start).max(1);
                        i = w.loop_start + (i - w.loop_start).rem_euclid(ll);
                    }
                    let valid = if w.looped { i >= 0 } else { i >= 0 && i < ln };
                    put(
                        j,
                        if valid {
                            w.data[i.clamp(0, ln - 1) as usize]
                        } else {
                            0
                        },
                    );
                }
                if !w.looped && self.pos >= ln {
                    self.ended = true;
                    self.hw_on = false;
                }
            }
            PSG => {
                let d = (self.duty & 7) as usize;
                for j in 0..n {
                    let i = idx(j);
                    put(
                        j,
                        if i >= 0 {
                            square(d, (i & 7) as usize)
                        } else {
                            0
                        },
                    );
                }
            }
            _ => {
                let ns = noise_seq();
                for j in 0..n {
                    let i = idx(j);
                    put(
                        j,
                        if i >= 0 {
                            ns[(i.max(0) % 32767) as usize]
                        } else {
                            0
                        },
                    );
                }
            }
        }
    }
}
