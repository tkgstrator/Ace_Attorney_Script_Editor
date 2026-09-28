"""SBNK（音色の表）と SWAR（波形の書庫）を読む。

SWAR の中の各波形（SWAV）は 12 バイトの見出し:
    u8 形式（0 = PCM8、1 = PCM16、2 = IMA-ADPCM）, u8 ループの有無, u16 サンプリング周波数,
    u16 タイマー（= 16756991 / 周波数。再生にはこちらを使う）, u16 ループ開始（4 バイト単位）,
    u32 ループ部分の長さ（4 バイト単位）
ADPCM は先頭の 4 バイトが (s16 初期値, u8 ステップの番号) で、ループ開始の位置にも含まれる。
ハードウェアはループ開始の位置での ADPCM の状態を覚えておいて戻すので、
あらかじめ全部を PCM に直してから繰り返しても結果は同じになる。

SBNK の音色（u8 種類, u16 位置, u8 予約）:
    1 = PCM（SWAV）、2 = PSG の矩形波（swav 番号がデューティ比）、3 = ノイズ、
    16 = ドラムセット（u8 下限, u8 上限, 以後 1 鍵ごとに u16 種類 + 10 バイト）、
    17 = 鍵盤分割（u8 × 8 の上限、以後 0 でない分割ごとに u16 種類 + 10 バイト）
10 バイトの中身: u16 swav, u16 swar（バンクの 4 個の波形書庫のどれか）, u8 基準の音, u8 A, D, S, R, u8 パン
"""
import struct
from dataclasses import dataclass, field

import numpy as np
from nds_sound_tables import ADPCM_INDEX, ADPCM_STEP


@dataclass
class Wave:
    """PCM に直した波形（int16 の配列）とループ"""
    data: np.ndarray           # int16
    timer: int                 # 1 サンプルの周期（チャンネルのクロック数）
    loop: bool
    loop_start: int            # サンプル単位
    rate: int                  # 見出しに書かれた周波数（参考）
    start_delay: int = 3       # 鍵盤を押してから最初のサンプルが出るまでの遅れ（サンプル数）


def decode_adpcm(body: bytes) -> np.ndarray:
    """DS の IMA-ADPCM（下位 4 ビットが先）を int16 に直す"""
    pred, idx = struct.unpack_from('<hB', body, 0)
    idx = min(max(idx, 0), 88)
    out = np.empty((len(body) - 4) * 2, dtype=np.int16)
    n = 0
    for b in body[4:]:
        for d in (b & 0xF, b >> 4):
            step = ADPCM_STEP[idx]
            diff = step >> 3
            if d & 1:
                diff += step >> 2
            if d & 2:
                diff += step >> 1
            if d & 4:
                diff += step
            if d & 8:
                pred = max(pred - diff, -0x7FFF)
            else:
                pred = min(pred + diff, 0x7FFF)
            idx = min(max(idx + ADPCM_INDEX[d & 7], 0), 88)
            out[n] = pred
            n += 1
    return out


def parse_swav(body: bytes) -> Wave:
    fmt, loop, rate, timer, loop_ofs, loop_len = struct.unpack_from('<BBHHHI', body, 0)
    raw = body[12:12 + (loop_ofs + loop_len) * 4]
    if fmt == 0:
        data = (np.frombuffer(raw, dtype=np.int8).astype(np.int16) << 8)
        ls = loop_ofs * 4
        delay = 3
    elif fmt == 1:
        data = np.frombuffer(raw[:len(raw) // 2 * 2], dtype='<i2').astype(np.int16)
        ls = loop_ofs * 2
        delay = 3
    elif fmt == 2:
        data = decode_adpcm(raw)
        ls = max(loop_ofs - 1, 0) * 8
        delay = 11
    else:
        raise ValueError(f'不明な波形の形式 {fmt}')
    if len(data) == 0:
        data = np.zeros(1, dtype=np.int16)
    return Wave(data=data, timer=timer, loop=bool(loop), loop_start=min(ls, len(data) - 1),
                rate=rate, start_delay=delay)


def parse_swar(body: bytes) -> list[Wave | None]:
    if body[:4] != b'SWAR':
        raise ValueError('SWAR ではありません')
    n = struct.unpack_from('<I', body, 0x38)[0]
    offs = [struct.unpack_from('<I', body, 0x3C + 4 * i)[0] for i in range(n)]
    out: list[Wave | None] = []
    for i, off in enumerate(offs):
        end = next((o for o in offs[i + 1:] if o > off), len(body))
        try:
            out.append(parse_swav(body[off:end]) if off else None)
        except (ValueError, struct.error):
            out.append(None)
    return out


@dataclass
class Region:
    """1 つの鍵の範囲の音色"""
    kind: int              # 1 = PCM、2 = PSG、3 = ノイズ
    swav: int              # PCM なら波形の番号、PSG ならデューティ比
    swar: int              # バンクの波形書庫の番号（0〜3）
    base_key: int
    attack: int
    decay: int
    sustain: int
    release: int
    pan: int
    low: int = 0           # この範囲の下限（ドラムセット用）
    high: int = 127        # この範囲の上限


@dataclass
class Instrument:
    kind: int                                  # 0 = 空、1〜3 = 単独、16 = ドラムセット、17 = 鍵盤分割
    regions: list[Region] = field(default_factory=list)

    def region_for(self, key: int) -> Region | None:
        """鍵 key で鳴らす範囲（無ければ None）。SSEQPlayer の NoteOn と同じ選び方"""
        if not self.regions:
            return None
        if self.kind == 16:
            if not (self.regions[0].low <= key <= self.regions[-1].high):
                return None
            return self.regions[key - self.regions[0].low]
        if self.kind == 17:
            for r in self.regions:
                if key <= r.high:
                    return r
            return None
        return self.regions[0]


def _region(body: bytes, off: int, kind: int, low: int = 0, high: int = 127) -> Region:
    swav, swar, base, a, d, s, r, pan = struct.unpack_from('<HHBBBBBB', body, off)
    return Region(kind, swav, swar, base, a, d, s, r, pan, low, high)


def parse_sbnk(body: bytes) -> list[Instrument]:
    if body[:4] != b'SBNK':
        raise ValueError('SBNK ではありません')
    n = struct.unpack_from('<I', body, 0x38)[0]
    out = []
    for i in range(n):
        kind, off, _ = struct.unpack_from('<BHB', body, 0x3C + 4 * i)
        inst = Instrument(kind)
        try:
            if 1 <= kind <= 5:
                inst.regions.append(_region(body, off, kind))
            elif kind == 16:
                low, high = body[off], body[off + 1]
                p = off + 2
                for k in range(low, high + 1):
                    sub = struct.unpack_from('<H', body, p)[0]
                    inst.regions.append(_region(body, p + 2, sub, k, k))
                    p += 12
            elif kind == 17:
                highs = list(body[off:off + 8])
                p = off + 8
                low = 0
                for h in highs:
                    if not h:
                        break
                    sub = struct.unpack_from('<H', body, p)[0]
                    inst.regions.append(_region(body, p + 2, sub, low, h))
                    low = h + 1
                    p += 12
        except struct.error:
            inst.regions = []
        out.append(inst)
    return out
