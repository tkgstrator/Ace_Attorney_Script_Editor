"""DS の音源ドライバー（NITRO-SDK の SND ライブラリ）が使う表と換算。

SSEQPlayer（FeOS Sound System 由来）・DeSmuME・GBATEK に書かれている動作に合わせている。
音量は「0.1 dB 単位の負の数」（0 = 最大、-723 ≒ 無音）で計算し、最後にハードウェアの
音量レジスター（0〜127 と割り算 1/2/4/16）に直す。
"""
import math

# ARM7 のクロック（Hz）。チャンネルのタイマーはこの半分で数える
ARM7_CLOCK = 33513982
CHANNEL_CLOCK = ARM7_CLOCK // 2           # 16756991
# ハードウェアのミキサーは 1024 クロックに 1 回出力する（= 32728.498 Hz）
OUTPUT_RATE = ARM7_CLOCK / 1024
OUTPUT_RATE_INT = 32728
# 音源ドライバーの 1 回分（フレーム）の長さ: タイマー 64 分周 × 2728 = 174592 クロック
# = 出力 170.5 サンプル（約 5.2 ms、191.96 Hz）
FRAME_CLOCKS = 64 * 2728
SAMPLES_PER_FRAME = FRAME_CLOCKS / 1024   # 170.5

AMPL_K = 723                   # 音量の下限（0.1 dB 単位）
AMPL_THRESHOLD = -AMPL_K << 7  # 包絡線（ADSR）の内部値の下限（-92544）

# 音量 0〜127 → 0.1 dB（40·log10(x/127)、つまり振幅の 2 乗の比）。SNDi_DecibelSquareTable 相当
# 先頭の 3 個だけ表の値が式と違う（下限で丸めてある）ので、表の値をそのまま使う
_SQ_HEAD = [-32768, -722, -721]
DECIBEL_SQUARE = _SQ_HEAD + [round(400 * math.log10(x / 127)) for x in range(3, 128)]

# 1/4 周期の正弦（0〜127）。LFO（モジュレーション）で使う
SINE_TABLE = [0, 6, 12, 19, 25, 31, 37, 43, 49, 54, 60, 65, 71, 76, 81, 85, 90, 94, 98, 102,
              106, 109, 112, 115, 118, 120, 122, 123, 125, 126, 126, 127, 127]

# アタックの速さ 109〜127 用の表（それより遅いものは 255 - 値）
_ATTACK_LUT = [0x00, 0x01, 0x05, 0x0E, 0x1A, 0x26, 0x33, 0x3F, 0x49, 0x54,
               0x5C, 0x64, 0x6D, 0x74, 0x7B, 0x7F, 0x84, 0x89, 0x8F]

# 音程の表: 1/768 オクターブ（1/64 半音）ごとの 0x10000·(2^(i/768) - 1)
PITCH_TABLE = [int(0x10000 * (2 ** (i / 768)) - 0x10000) for i in range(768)]

# ハードウェアの音量レジスター（0〜127）: 0〜723 の添字（= 0.1 dB + 723）から引く。
# 割り算（1/2/4/16）と組み合わせて、大きいほど 127 に近い値になるように作られている
_DIV_SHIFT = [0, 1, 2, 4]


def _volume_register(index: int) -> tuple[int, int]:
    """0〜723 の添字 → (音量 0〜127, 割り算の番号 0〜3)"""
    db = index - AMPL_K
    div = 3 if db < -240 else 2 if db < -120 else 1 if db < -60 else 0
    amp = 10 ** (db / 200) * (1 << _DIV_SHIFT[div])
    return min(127, int(amp * 127 + 0.5)), div


VOLUME_REGISTERS = [_volume_register(i) for i in range(AMPL_K + 1)]


def cnv_sust(v: int) -> int:
    """音量・表情・ベロシティ・サステインの 0〜127 → 0.1 dB"""
    if v & 0x80:
        v = 0x7F
    return DECIBEL_SQUARE[v]


def cnv_attack(a: int) -> int:
    """アタックの値 → 1 フレームごとに掛ける係数（/255）"""
    if a & 0x80:
        a = 0
    return _ATTACK_LUT[0x7F - a] if a >= 0x6D else 0xFF - a


def cnv_fall(f: int) -> int:
    """ディケイ・リリースの値 → 1 フレームごとに引く量（内部値の単位）"""
    if f & 0x80:
        f = 0
    if f == 0x7F:
        return 0xFFFF
    if f == 0x7E:
        return 0x3C00
    if f < 0x32:
        return ((f << 1) + 1) & 0xFFFF
    return (0x1E00 // (0x7E - f)) & 0xFFFF


def cnv_sine(arg: int) -> int:
    """0〜127 の位相 → -127〜127"""
    if arg < 0x20:
        return SINE_TABLE[arg]
    if arg < 0x40:
        return SINE_TABLE[0x40 - arg]
    if arg < 0x60:
        return -SINE_TABLE[arg - 0x40]
    return -SINE_TABLE[0x20 - (arg - 0x60)]


def timer_adjust(base: int, pitch: int) -> int:
    """タイマーの値（周期のクロック数）を pitch（1/64 半音）だけ上げたものにする"""
    shift = 0
    pitch = -pitch
    while pitch < 0:
        shift -= 1
        pitch += 0x300
    while pitch >= 0x300:
        shift += 1
        pitch -= 0x300
    tmr = base * (PITCH_TABLE[pitch] + 0x10000)
    shift -= 16
    if shift <= 0:
        tmr >>= -shift
    elif shift < 32:
        if tmr & (~0 << (32 - shift)) & 0xFFFFFFFFFFFFFFFF:
            return 0xFFFF
        tmr <<= shift
    else:
        return 0x10
    return max(0x10, min(0xFFFF, tmr))


def volume_gain(total_db: int) -> tuple[int, int]:
    """0.1 dB の合計 → (音量レジスター, 割り算の番号)。SSEQPlayer の Channel::Update と同じ"""
    idx = total_db + AMPL_K
    if idx < 0:
        idx = 0
    elif idx > AMPL_K:
        idx = AMPL_K
    return VOLUME_REGISTERS[idx]


def register_amplitude(vol: int, div: int) -> float:
    """音量レジスターの値 → 実際の倍率"""
    return vol / 128 / (1 << _DIV_SHIFT[div])


# IMA-ADPCM の表
ADPCM_INDEX = [-1, -1, -1, -1, 2, 4, 6, 8]
ADPCM_STEP = [
    7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66,
    73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408,
    449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066,
    2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630,
    9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794,
    32767]
