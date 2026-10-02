"""DS の音源の 1 チャンネル分（音源ドライバーの ExChannel + ハードウェアのチャンネル）。

1 フレーム（約 5.2 ms）ごとに update() で包絡線（ADSR）・LFO・ポルタメントを進めて
ハードウェアのレジスター（音量・割り算・パン・タイマー）を決め、render() でそのフレームの
サンプルを作る。動作は SSEQPlayer の Channel::Update に合わせている。

ハードウェアは補間をしない: チャンネルのタイマーが 16756991 Hz で数え、ミキサーは
1024 クロック（= チャンネルの 512 クロック）ごとにその時点のサンプルをそのまま拾う。
ここでも同じ整数の計算で拾うので、エイリアシングも含めて実機と同じ音になるはず。
"""
import numpy as np
from nds_sbnk_swar import Wave
from nds_sound_tables import (
    AMPL_K,
    AMPL_THRESHOLD,
    cnv_sine,
    cnv_sust,
    register_amplitude,
    timer_adjust,
    volume_gain,
)

NONE, START, ATTACK, DECAY, SUSTAIN, RELEASE = range(6)

PCM, PSG, NOISE = 1, 2, 3
PSG_BASE_TIMER = 8006   # NCSFCommon/Channel.cs の StartPSG・StartNoise（キー60）。


def _noise_sequence() -> np.ndarray:
    """ノイズのチャンネルの 15 ビット LFSR の出力（周期 32767）"""
    x = 0x7FFF
    out = np.empty(32767, dtype=np.int16)
    for i in range(32767):
        if x & 1:
            x = (x >> 1) ^ 0x6000
            out[i] = -0x7FFF
        else:
            x >>= 1
            out[i] = 0x7FFF
    return out


NOISE_SEQ = _noise_sequence()
# 矩形波: デューティ d（0〜6）は 8 段のうち d+1 段が高い。7 は常に低い
SQUARE = np.array([[0x7FFF if i >= 7 - d and d < 7 else -0x7FFF for i in range(8)]
                   for d in range(8)], dtype=np.int16)


class Channel:
    def __init__(self, no: int):
        self.no = no
        self.state = NONE
        self.prio = 0
        self.track = None           # このチャンネルを鳴らしている Track
        self.key = 60
        self.org_key = 60
        self.velocity = 0           # 0.1 dB
        self.pan = 0                # 音色のパン（-64〜63）
        self.ext_ampl = 0
        self.ext_pan = 0
        self.ext_tune = 0
        self.attack = 0
        self.decay = 0
        self.sustain = 0
        self.release = 0
        self.ampl = AMPL_THRESHOLD
        self.mod_type = 0
        self.mod_speed = 0
        self.mod_depth = 0
        self.mod_range = 0
        self.mod_delay = 0
        self.mod_delay_cnt = 0
        self.mod_counter = 0
        self.sweep_pitch = 0
        self.sweep_len = 0
        self.sweep_cnt = 0
        self.manual_sweep = False
        self.note_length = -1
        self.started_tick = False   # 今の音が鳴り始めたティックのうちは長さを数えない
        # 音源
        self.kind = PCM
        self.wave: Wave | None = None
        self.duty = 0
        self.base_timer = 0
        # ハードウェアのレジスター
        self.hw_on = False
        self.hw_vol = 0
        self.hw_div = 0
        self.hw_pan = 64
        self.hw_timer = 0x10
        self.pos = 0                # 今のサンプルの位置（負 = まだ出ていない）
        self.acc = 0                # タイマーの端数（クロック）
        self.ended = False          # ループしない波形が終わった

    # --- 音源ドライバー側 ---------------------------------------------------------
    @property
    def amplitude(self) -> float:
        """チャンネルを奪うときの比べ方に使う音量"""
        return register_amplitude(self.hw_vol, self.hw_div) if self.state != NONE else 0.0

    def kill(self):
        self.state = NONE
        self.prio = 0
        self.track = None
        self.hw_on = False
        self.hw_vol = 0

    def do_release(self):
        if self.state != NONE:
            self.state = RELEASE
            self.prio = 1

    def update_from_track(self, trk, player):
        """トラックの音量・パン・音程・LFO をチャンネルに写す（UpdateVol/Pan/Tune/Mod）"""
        # NCSFCommon/Track.cs の UpdateChannel はリリース中の値を保つ。
        if self.state == RELEASE:
            return
        v = player.master_vol + player.seq_vol + cnv_sust(trk.vol) + cnv_sust(trk.expr)
        self.ext_ampl = max(v, -0x8000)
        self.ext_pan = trk.pan
        tune = (self.key - self.org_key) * 64
        tune += (trk.bend * trk.bend_range) >> 1
        self.ext_tune = tune
        self.mod_type = trk.mod_type
        self.mod_speed = trk.mod_speed
        self.mod_depth = trk.mod_depth
        self.mod_range = trk.mod_range
        self.mod_delay = trk.mod_delay

    def start_porta(self, trk):
        """ポルタメント・スイープの設定（UpdatePorta）"""
        self.manual_sweep = False
        self.sweep_pitch = trk.sweep_pitch
        self.sweep_cnt = 0
        if not trk.porta:
            self.sweep_len = 0
            return
        diff = (trk.porta_key - self.key) << 22
        self.sweep_pitch += diff >> 16
        if not trk.porta_time:
            self.sweep_len = self.note_length
            self.manual_sweep = True
        else:
            self.sweep_len = (abs(self.sweep_pitch) * trk.porta_time * trk.porta_time) >> 11

    def update(self):
        """1 フレーム進める（Channel::Update）"""
        if self.state == NONE:
            return
        if self.ended:
            self.kill()
            return
        if self.state == START:
            self.hw_on = True
            # NCSFCommon/Channel.cs の StartPSG・StartNoise は1段待って開始する。
            self.pos = -(self.wave.start_delay if self.kind == PCM and self.wave else 1)
            self.acc = 0
            self.ampl = AMPL_THRESHOLD
            self.state = ATTACK
        if self.state == ATTACK:
            # C の整数の割り算（0 の方へ切り捨て）
            p = self.attack * self.ampl
            self.ampl = -((-p) // 255) if p < 0 else p // 255
            if self.ampl == 0:
                self.state = DECAY
        elif self.state == DECAY:
            self.ampl -= self.decay
            sus = cnv_sust(self.sustain) << 7
            if self.ampl <= sus:
                self.ampl = sus
                self.state = SUSTAIN
        elif self.state == RELEASE:
            self.ampl -= self.release
            if self.ampl <= AMPL_THRESHOLD:
                self.kill()
                return

        modulate = self.mod_depth != 0
        mod = 0
        if modulate and self.mod_delay_cnt < self.mod_delay:
            self.mod_delay_cnt += 1
            modulate = False
        if modulate:
            mod = cnv_sine(self.mod_counter >> 8) * self.mod_range * self.mod_depth
            if self.mod_type == 1:
                mod = (mod * 60) >> 14
            else:
                mod >>= 8
            self.mod_counter = (self.mod_counter + (self.mod_speed << 6)) & 0x7FFF

        # 音程（タイマー）
        adj = self.ext_tune
        if self.mod_type == 0:
            adj += mod
        if self.sweep_pitch and self.sweep_len and self.sweep_cnt <= self.sweep_len:
            n = self.sweep_pitch * (self.sweep_len - self.sweep_cnt)
            adj += int(n / self.sweep_len)        # C と同じく 0 の方へ切り捨て
            if not self.manual_sweep:
                self.sweep_cnt += 1
        tmr = self.base_timer
        if adj:
            tmr = timer_adjust(tmr, adj)
        self.hw_timer = max(tmr, 0x10)

        # 音量
        total = (self.ampl >> 7) + self.ext_ampl + self.velocity
        if self.mod_type == 1:
            total += mod
        self.hw_vol, self.hw_div = volume_gain(total)
        if total + AMPL_K <= 0:
            self.hw_vol, self.hw_div = 0, 0
        # パン
        pan = self.pan + self.ext_pan
        if self.mod_type == 2:
            pan += mod
        self.hw_pan = min(max(pan + 64, 0), 127)

    # --- ハードウェア側 ------------------------------------------------------------
    def render(self, n: int, out_l: np.ndarray, out_r: np.ndarray):
        """n サンプル分を作って out_l/out_r に足す"""
        if not self.hw_on or n <= 0:
            return
        count = self.hw_timer
        cum = self.acc + 512 * np.arange(n, dtype=np.int64)
        idx = self.pos + cum // count
        total = self.acc + 512 * n
        self.pos += total // count
        self.acc = total % count
        if self.hw_vol == 0:
            # 音は出ないが位置は進める（波形の終わりも調べる）
            if self.kind == PCM and self.wave is not None and not self.wave.loop \
                    and self.pos >= len(self.wave.data):
                self.ended = True
                self.hw_on = False
            return
        if self.kind == PCM:
            w = self.wave
            data = w.data
            ln = len(data)
            if w.loop:
                over = idx >= ln
                if over.any():
                    ll = max(ln - w.loop_start, 1)
                    idx = np.where(over, w.loop_start + (idx - w.loop_start) % ll, idx)
                valid = idx >= 0
                smp = np.where(valid, data[np.clip(idx, 0, ln - 1)], 0)
            else:
                valid = (idx >= 0) & (idx < ln)
                smp = np.where(valid, data[np.clip(idx, 0, ln - 1)], 0)
                if self.pos >= ln:
                    self.ended = True
                    self.hw_on = False
        elif self.kind == PSG:
            smp = np.where(idx >= 0, SQUARE[self.duty & 7][idx & 7], 0)
        else:
            smp = np.where(idx >= 0, NOISE_SEQ[np.maximum(idx, 0) % 32767], 0)
        g = register_amplitude(self.hw_vol, self.hw_div)
        x = smp.astype(np.float64) * g
        out_l += x * ((128 - self.hw_pan) / 128)
        out_r += x * (self.hw_pan / 128)
