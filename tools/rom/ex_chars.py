"""キャラクターのアニメーション（OAM スプライト）の書き出し。

data.bin の後半にある「キャラクターのパック」は (画像, 動き) の組が並んだもので、1 組が 1 つのアニメーション。

画像（gfx）:
    u32 0x80000000 | パレット数 n
    パレット 32 バイト × n（16 色ずつ、BGR555）
    u32 の位置の表（この表の先頭から数える。最初の値 / 4 が部品の数）
    部品ごとの独自の RLE: u16 の制御語を読み、最上位ビットが 1 なら次の u16 を (下位 15 ビット) 回繰り返し、
    0 なら続く (下位 15 ビット) 個の u16 をそのまま写す。展開すると 4bpp のタイル（横方向に並ぶ）になる
動き（anim）:
    u16 0, u16 コマ送りの数 m
    m × (u16 コマの位置, u16 表示する長さ（1/60 秒単位、0xFF は最後）, u32 0)
    コマ: u16 部品の数 k, u16 0, k × (s8 x, s8 y, u8 部品番号, u8 属性)
    属性の上位 4 ビットは OAM の形と大きさ（(大きさ << 2) | 形）、下位 4 ビット × n / 16 がパレットの番号
"""
import struct
import subprocess
from pathlib import Path

import numpy as np

import gfx

# OAM の (大きさ << 2) | 形 → (幅, 高さ)
OAM_SIZE = {0: (8, 8), 1: (16, 8), 2: (8, 16), 4: (16, 16), 5: (32, 8), 6: (8, 32),
            8: (32, 32), 9: (32, 16), 10: (16, 32), 12: (64, 64), 13: (64, 32), 14: (32, 64)}


def unrle16(c: bytes) -> bytes:
    out, q = bytearray(), 0
    while q + 2 <= len(c):
        ctl = struct.unpack_from('<H', c, q)[0]
        q += 2
        n = ctl & 0x7FFF
        if ctl & 0x8000:
            out += c[q:q + 2] * n
            q += 2
        else:
            out += c[q:q + 2 * n]
            q += 2 * n
    return bytes(out)


def parse_gfx(b: bytes):
    """(パレットの一覧, 部品の 4bpp データの一覧) を返す"""
    npal = struct.unpack_from('<I', b, 0)[0] & 0xFF
    pals = [gfx.palette(b[4 + 32 * i:36 + 32 * i]) for i in range(npal)]
    q = 4 + 32 * npal
    n = struct.unpack_from('<I', b, q)[0] // 4
    offs = list(struct.unpack_from(f'<{n}I', b, q)) + [len(b) - q]
    return pals, [unrle16(b[q + offs[i]:q + offs[i + 1]]) for i in range(n)]


def parse_anim(b: bytes):
    """(コマ送りの一覧 [(コマの位置, 長さ)], コマの位置 → 部品の一覧) を返す"""
    m = struct.unpack_from('<H', b, 2)[0]
    seq = [struct.unpack_from('<HH', b, 8 + 8 * i) for i in range(m)]
    frames = {}
    for off, _ in seq:
        if off in frames or off + 4 > len(b):
            continue
        k = struct.unpack_from('<H', b, off)[0]
        frames[off] = [struct.unpack_from('<bbBB', b, off + 4 + 4 * j) for j in range(k)
                       if off + 8 + 4 * j <= len(b)]
    return seq, frames


def _pieces(pals, cells, frame):
    out = []
    for x, y, i, attr in frame:
        size = OAM_SIZE.get(attr >> 4)
        if not size or i >= len(cells):
            continue
        w, h = size
        if len(cells[i]) * 2 < w * h:
            continue
        idx = gfx.tiled(gfx.unpack4(cells[i]), w, h)
        pal = np.array(pals[min((attr & 15) * len(pals) // 16, len(pals) - 1)], np.uint8)
        rgba = np.zeros((h, w, 4), np.uint8)
        rgba[..., :3] = pal[idx]
        rgba[..., 3] = (idx != 0) * 255          # 色番号 0 は透明
        out.append((x, y, rgba))
    return out


def render(pals, cells, frames: dict):
    """全部のコマを同じ大きさ（全コマを囲む四角）で描き、(コマの位置 → RGBA 画像, 原点の位置) を返す"""
    all_p = {off: _pieces(pals, cells, f) for off, f in frames.items()}
    flat = [p for ps in all_p.values() for p in ps]
    if not flat:
        return {}, (0, 0)
    x0 = min(p[0] for p in flat)
    y0 = min(p[1] for p in flat)
    x1 = max(p[0] + p[2].shape[1] for p in flat)
    y1 = max(p[1] + p[2].shape[0] for p in flat)
    out = {}
    for off, ps in all_p.items():
        can = np.zeros((y1 - y0, x1 - x0, 4), np.uint8)
        for x, y, img in reversed(ps):          # 先に書かれた部品ほど手前
            sub = can[y - y0:y - y0 + img.shape[0], x - x0:x - x0 + img.shape[1]]
            np.copyto(sub, img, where=img[..., 3:] != 0)
        out[off] = can
    return out, (-x0, -y0)


def export_pack(parts: list[bytes], dst: Path, gif: bool = True) -> list[Path]:
    """キャラクターのパックを書き出し、一覧用に各アニメーションの最初のコマの画像の一覧を返す"""
    firsts = []
    for k in range(0, len(parts) - 1, 2):
        d = dst / f'{k // 2:03}'
        d.mkdir(parents=True, exist_ok=True)
        try:
            pals, cells = parse_gfx(parts[k])
            seq, frames = parse_anim(parts[k + 1])
            imgs, origin = render(pals, cells, frames)
        except (struct.error, IndexError, ValueError) as e:
            (d / 'error.txt').write_text(f'読み取れませんでした: {e}\n')
            continue
        names = {}
        for n, (off, img) in enumerate(sorted(imgs.items())):
            names[off] = d / f'f{n:02}.png'
            gfx.write_rgba_png(names[off], img)
        rows = [f'{names[o].name if o in names else "-"}\t{t}' for o, t in seq]
        (d / 'anim.tsv').write_text(f'# 原点（キャラクターの基準点）: 画像の {origin}\nコマ\t長さ（1/60 秒）\n'
                                    + '\n'.join(rows) + '\n')
        if seq and seq[0][0] in names:
            firsts.append(names[seq[0][0]])
        if gif and len(names) > 1:
            args = []
            for o, t in seq:
                if o in names:
                    args += ['-delay', str(max(2, round(min(t, 120) * 100 / 60))), str(names[o])]
            subprocess.run(['magick', '-dispose', 'background', *args, '-loop', '0', str(d / 'anim.gif')],
                           check=False, capture_output=True)
    return firsts
