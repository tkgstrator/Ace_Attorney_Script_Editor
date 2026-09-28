"""SSEQ（DS の標準のシーケンス）の演奏。音源ドライバーの Player と Track に当たる。

1 フレームごとに:
    1. 各チャンネルにトラックの音量・パン・音程・LFO を写す
    2. 各チャンネルの包絡線などを進める（sseq_channel.Channel.update）
    3. テンポのカウンターに テンポ × 256 / 256 を足し、240 を超えるたびに 1 ティック進める
ティックでは、各チャンネルの残りの長さを 1 減らし（0 で離鍵）、各トラックの命令を実行する。

命令（引数）:
    00-7F 音符（u8 ベロシティ, 可変長 長さ）  80 休符  81 音色  93 トラックを開く（u8, u24）
    94 ジャンプ  95 サブルーチン  A0 乱数  A1 変数  A2 条件付き  B0-BD 変数の演算
    C0 パン  C1 音量  C2 全体の音量  C3 移調  C4 ピッチベンド  C5 ベンドの幅  C6 優先度
    C7 モノ/ポリ  C8 タイ  C9 ポルタメントの始まりの音  CA-CD LFO の深さ・速さ・種類・幅
    CE ポルタメント  CF ポルタメントの時間  D0-D3 ADSR  D4 ループ開始  D5 表情  D6 表示
    E0 LFO の遅れ  E1 テンポ  E3 スイープ  FC ループ終わり  FD 戻る  FE トラックの一覧  FF 終わり
"""
from nds_sbnk_swar import Instrument, Wave
from nds_sound_tables import cnv_attack, cnv_fall, cnv_sust
from sseq_channel import NOISE, NONE, PCM, PSG, PSG_BASE_TIMER, START, Channel
from sseq_track import ARGS, Track  # noqa: F401  （ARGS は調べる道具のために公開）

# 空いているチャンネルを探す順番（SSEQPlayer の ChannelAlloc と同じ）
PCM_ORDER = [4, 5, 6, 7, 2, 0, 3, 1, 8, 9, 10, 11, 14, 12, 15, 13]
PSG_ORDER = [8, 9, 10, 11, 12, 13]
NOISE_ORDER = [14, 15]


class Player:
    def __init__(self, sseq: bytes, bank: list[Instrument], waves: list[list[Wave | None]],
                 seq_vol: int = 127, prio: int = 64, channel_mask: int = 0xFFFF):
        if sseq[:4] != b'SSEQ':
            raise ValueError('SSEQ ではありません')
        self.data = sseq
        self.base = int.from_bytes(sseq[0x18:0x1C], 'little')
        self.bank = bank
        self.waves = waves
        self.seq_vol = cnv_sust(seq_vol)
        self.master_vol = 0
        self.prio = prio
        self.mask = channel_mask or 0xFFFF
        self.tempo = 120
        self.tempo_rate = 256
        self.tempo_count = 0
        self.vars = [-1] * 32
        self.seed = 0x12345678
        self.used_random = False                    # 乱数を使った（実機と同じ音にはならない）
        self.channels = [Channel(i) for i in range(16)]
        self.tracks: list[Track] = [Track(self, 0, self.base)]
        self.tick_no = 0
        self.frame_no = 0
        self.tick_frames: list[int] = []            # ティック → そのティックを実行したフレーム
        self.tick_phase: list[int] = []             # ティック → そのときのテンポのカウンターの端数
        self.loops: dict[int, list[tuple[int, int]]] = {}   # トラック番号 → [(ティック, 先)]
        self.missing: set[str] = set()

    # --- 補助 ---
    def random(self) -> int:
        self.used_random = True
        self.seed = (self.seed * 1664525 + 1013904223) & 0xFFFFFFFF
        return self.seed >> 16

    def var_get(self, i: int) -> int:
        return self.vars[i & 31]

    def var_set(self, i: int, v: int):
        v &= 0xFFFF
        self.vars[i & 31] = v - 0x10000 if v >= 0x8000 else v

    def open_track(self, no: int, ofs: int):
        if len(self.tracks) >= 16:
            return
        self.tracks.append(Track(self, no, self.base + ofs))

    def loop_event(self, trk: Track, target: int):
        self.loops.setdefault(trk.no, []).append((self.tick_no, target))

    def release_track(self, trk: Track):
        for ch in self.channels:
            if ch.track is trk and ch.state != NONE:
                ch.do_release()

    @property
    def finished(self) -> bool:
        return all(t.end for t in self.tracks) and all(c.state == NONE for c in self.channels)

    # --- チャンネル ---
    def alloc(self, kind: int, prio: int) -> Channel | None:
        order = PCM_ORDER if kind == PCM else PSG_ORDER if kind == PSG else NOISE_ORDER
        cur = None
        for no in order:
            if not self.mask & (1 << no):
                continue
            c = self.channels[no]
            if cur is not None and c.prio >= cur.prio:
                if c.prio != cur.prio or cur.amplitude <= c.amplitude:
                    continue
            cur = c
        if cur is None or prio < cur.prio:
            return None
        cur.kill()
        return cur

    def note_on(self, trk: Track, key: int, vel: int, length: int) -> Channel | None:
        if trk.patch >= len(self.bank):
            return None
        reg = self.bank[trk.patch].region_for(key)
        if reg is None or reg.kind not in (PCM, PSG, NOISE):
            return None
        wave = None
        if reg.kind == PCM:
            arc = self.waves[reg.swar] if reg.swar < len(self.waves) else None
            wave = arc[reg.swav] if arc and reg.swav < len(arc) else None
            if wave is None:
                self.missing.add(f'swar{reg.swar}/swav{reg.swav}')
                return None
        ch = self.alloc(reg.kind, trk.prio)
        if ch is None:
            return None
        ch.kind = reg.kind
        ch.wave = wave
        ch.duty = reg.swav
        ch.base_timer = wave.timer if wave else PSG_BASE_TIMER
        ch.state = START
        ch.track = trk
        ch.prio = trk.prio
        ch.key = key
        ch.org_key = reg.base_key
        ch.velocity = cnv_sust(vel)
        ch.pan = reg.pan - 64
        ch.mod_delay_cnt = 0
        ch.mod_counter = 0
        ch.note_length = length
        ch.started_tick = True
        ch.ended = False
        ch.attack = cnv_attack(reg.attack if trk.a == 0xFF else trk.a)
        ch.decay = cnv_fall(reg.decay if trk.d == 0xFF else trk.d)
        ch.sustain = reg.sustain if trk.s == 0xFF else trk.s
        ch.release = cnv_fall(reg.release if trk.r == 0xFF else trk.r)
        ch.update_from_track(trk, self)
        ch.start_porta(trk)
        return ch

    # --- 進める ---
    def run_tick(self):
        self.tick_frames.append(self.frame_no)
        self.tick_phase.append(self.tempo_count)
        for ch in self.channels:
            if ch.state == NONE or ch.track is None:
                continue
            if ch.started_tick:
                continue
            if ch.state != 1 and ch.note_length > 0:
                ch.note_length -= 1
                if ch.note_length == 0 and ch.state < 5:
                    ch.do_release()
            if ch.manual_sweep and ch.sweep_cnt < ch.sweep_len:
                ch.sweep_cnt += 1
        i = 0
        while i < len(self.tracks):             # 開いたばかりのトラックも同じティックで動く
            self.tracks[i].tick()
            i += 1
        for ch in self.channels:
            ch.started_tick = False
        self.tick_no += 1

    def frame(self):
        """1 フレーム分の音源ドライバーの処理"""
        for ch in self.channels:
            if ch.state != NONE and ch.track is not None:
                ch.update_from_track(ch.track, self)
            ch.update()
        self.tempo_count += (self.tempo * self.tempo_rate) >> 8
        while self.tempo_count >= 240:
            self.tempo_count -= 240
            self.run_tick()
        self.frame_no += 1
