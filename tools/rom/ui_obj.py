"""下画面（メインエンジン）の UI 部品（OBJ）の読み取り。ex_ui.py から使う。

分かったこと（ARM9 を逆アセンブルして確認。確かさ: 確実）:

- 下画面はメインエンジン（3D を持つ方）、上画面はサブエンジン。VRAM への転送は 0x02019878(位置, 転送先, 大きさ, 種類) が
  data.bin を読んで予約し、VBlank で種類ごとの SDK の関数（0x02019a0c の表）で書く。
  種類 3 = メイン OBJ パレット（0x05000200）、4 = メイン OBJ（0x06400000）、6 = メイン BG パレット、
  14 = サブ OBJ パレット、15 = サブ OBJ（0x06600000）、17 = サブ BG パレット、18〜21 = サブ BG0〜3 のタイル。
- 部品の表 0x020bb198: 0x1c バイト × 108。{u8 番号, u8 形, u16 0, u32 日本語の位置, u32 大きさ,
  u32 英語の位置, u32 大きさ, u16 VRAM のタイル番号(実行時), ...}。画素は data.bin の末尾の未解明の領域
  （0x2f3e1f8〜）にある圧縮なしの 4bpp タイル。0x02043718 がメイン OBJ（種類 4）に 1 部品ずつ読み込む。
- 形の表 0x020bacbc: 6 バイト × 15 = (横の個数, 縦の個数, OBJ の形の番号)。OBJ の形の番号 → 幅・高さは 0x020bac5c、
  OAM の形・大きさのビットは 0x020bac2c、1 個の OBJ のタイル数は 0x020bac8c。
  1 部品 = 同じ形の OBJ を横 → 縦に並べたもの。各 OBJ のタイルは 1D マッピング（OBJ の中で横 → 縦）で続く。
- 描画 0x02044098(部品, x, y, パレット, 優先度, 左右反転, 上下反転, 半透明など)。
- パレットは data.bin 0x2f51268〜（16 色 × 33 個）。法廷の画面の準備（0x02044354〜）で
  OBJ パレット 2 = 0x2f51288（茶色のボタン）、4 = 0x2f51348、5 = 0x2f51268（枠・マイクの印）、6 = 0x2f51368（題の札）。
- 色: スクリーンショット（メインエンジン = 3D あり、6 ビットで出力）と画素単位で一致する変換は
  c6 = 2v + (v > 0)、c8 = round(c6 × 255 / 63)（v は BGR555 の 5 ビット）。
"""
import struct

import numpy as np

B = 0x02000000
RECORDS = 0x020bb198      # 部品の表
N_RECORDS = 108
SHAPE_WH = 0x020bac5c     # OBJ の形 → (幅, 高さ)
GROUPS = 0x020bacbc       # 部品の形 → (横の個数, 縦の個数, OBJ の形)
N_GROUPS = 15
PAL_BASE = 0x2f51268      # OBJ のパレット（16 色 × 33）
PAL_COUNT = 33


def _h(a: bytes, addr: int) -> int:
    return struct.unpack_from('<H', a, addr - B)[0]


def shapes(a: bytes) -> dict[int, tuple[int, int]]:
    return {i: (_h(a, SHAPE_WH + 4 * i), _h(a, SHAPE_WH + 4 * i + 2)) for i in range(12)}


def groups(a: bytes) -> list[tuple[int, int, int]]:
    return [(_h(a, GROUPS + 6 * k), _h(a, GROUPS + 6 * k + 2), _h(a, GROUPS + 6 * k + 4)) for k in range(N_GROUPS)]


def records(a: bytes) -> list[dict]:
    out = []
    for i in range(N_RECORDS):
        num, grp, _, ja, jas, en, ens = struct.unpack_from('<BBHIIII', a, RECORDS - B + i * 0x1c)
        out.append({'index': i, 'id': num, 'group': grp, 'ja': (ja, jas), 'en': (en, ens)})
    return out


def layout(a: bytes, grp: int) -> tuple[int, int, int, int]:
    """部品の形 → (幅, 高さ, 横の個数, 縦の個数, OBJ の幅, OBJ の高さ)"""
    cols, rows, sh = groups(a)[grp]
    w, h = shapes(a)[sh]
    return cols * w, rows * h, cols, rows, w, h


def render(a: bytes, d: bytes, grp: int, off: int, size: int) -> np.ndarray:
    """部品の 4bpp タイルを並べて (高さ, 幅) の色番号の配列にする（0 = 透明）"""
    W, H, cols, rows, w, h = layout(a, grp)
    raw = np.frombuffer(d[off:off + size], np.uint8)
    px = np.empty(raw.size * 2, np.uint8)
    px[0::2], px[1::2] = raw & 15, raw >> 4
    img = np.zeros((H, W), np.uint8)
    t = 0
    for r in range(rows):
        for c in range(cols):
            for ty in range(h // 8):
                for tx in range(w // 8):
                    if (t + 1) * 64 <= px.size:
                        y, x = r * h + ty * 8, c * w + tx * 8
                        img[y:y + 8, x:x + 8] = px[t * 64:t * 64 + 64].reshape(8, 8)
                    t += 1
    return img


def c8(v):
    """5 ビットの色 → スクリーンショットの 8 ビット（メインエンジンの 6 ビット出力と同じ）"""
    v = np.asarray(v, int)
    c6 = v * 2 + (v > 0)
    return (c6 * 255 + 31) // 63


def palette(d: bytes, off: int) -> np.ndarray:
    """BGR555 × 16 → (16, 3) の 8 ビット RGB"""
    p = np.frombuffer(d[off:off + 32], '<u2').astype(int)
    return np.stack([c8(p & 31), c8(p >> 5 & 31), c8(p >> 10 & 31)], 1).astype(np.uint8)


def rgba(idx: np.ndarray, pal: np.ndarray) -> np.ndarray:
    out = np.zeros(idx.shape + (4,), np.uint8)
    out[..., :3] = pal[idx]
    out[..., 3] = np.where(idx > 0, 255, 0)
    return out
