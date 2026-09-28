"""MT Framework（3DS 版）の TEX を PNG にする。逆転裁判5（版 0xA5）・6（版 0xA6）で確認。

    uv run tools/rom/mt_tex.py <入力フォルダー…> --out <出力先>

入力フォルダーの下のすべての .tex を <出力先>/<入力フォルダーの名前>/<相対パス>.png に書く（いちばん大きいミップマップだけ）。
キューブマップは 1 面目だけ。<出力先>/index.tsv に一覧（形式・大きさ・書き出せたか）を書く。

形式: "TEX\\0"、u32（下位 12 ビットが版）、u32（下位 6 ビットがミップマップの数、6〜18 ビット目が幅、19〜31 ビット目が高さ）、
u32（下位 8 ビットが面の数、8〜15 ビット目が画素の形式）、ミップマップの位置 u32 × (数 × 面)、画素。
画素は 3DS の GPU の並び（8×8 のタイルの中が Z 順。ETC1 は 4×4 のブロックが 8×8 の中で Z 順、ブロックは 64 ビットの
リトルエンディアン、ETC1A4 はその前に 4 ビット × 16 の透明度（x * 4 + y の順））。
3DS のほかのゲームと違い、上下を戻さずにそのまま並べると正しい向きになる（文字の入ったテクスチャで確認）。
"""
import argparse
import struct
from pathlib import Path

import numpy as np
import texture2ddecoder
from PIL import Image

# 形式の番号 → (名前, 1 画素のビット数)。16・7 は画像を見て決めた
FORMATS = {
    1: ('rgba4444', 16), 2: ('rgba5551', 16), 3: ('rgba8', 32), 4: ('rgb565', 16), 5: ('a8', 8),
    7: ('la8', 16), 11: ('etc1', 4), 12: ('etc1a4', 8), 14: ('a4', 4), 15: ('l4', 4),
    16: ('l8', 8), 17: ('rgb8', 24),
}


def z_order(w: int, h: int) -> tuple[np.ndarray, np.ndarray]:
    """並んだ画素の番号 → 画像の (y, x)"""
    i = np.arange(w * h)
    tile, p = i // 64, i % 64
    x = (p & 1) | ((p >> 1) & 2) | ((p >> 2) & 4)
    y = ((p >> 1) & 1) | ((p >> 2) & 2) | ((p >> 3) & 4)
    tx, ty = tile % (w // 8), tile // (w // 8)
    return ty * 8 + y, tx * 8 + x


def expand(v: np.ndarray, bits: int) -> np.ndarray:
    return (v.astype(np.uint32) * 255 // ((1 << bits) - 1)).astype(np.uint8)


def pixels(fmt: str, raw: bytes, n: int) -> np.ndarray:
    """並んだ画素を RGBA（n × 4）にする"""
    b = np.frombuffer(raw, np.uint8)
    out = np.full((n, 4), 255, np.uint8)
    if fmt == 'rgba8':
        out[:] = b[:n * 4].reshape(n, 4)[:, ::-1]
    elif fmt == 'rgb8':
        out[:, :3] = b[:n * 3].reshape(n, 3)[:, ::-1]
    elif fmt in ('rgba4444', 'rgba5551', 'rgb565'):
        v = np.frombuffer(raw[:n * 2], '<u2').astype(np.uint32)
        if fmt == 'rgba4444':
            parts = [(v >> 12, 4), (v >> 8, 4), (v >> 4, 4), (v, 4)]
        elif fmt == 'rgba5551':
            parts = [(v >> 11, 5), (v >> 6, 5), (v >> 1, 5), (v, 1)]
        else:
            parts = [(v >> 11, 5), (v >> 5, 6), (v, 5)]
        for c, (x, bits) in enumerate(parts):
            out[:, c] = expand(x & ((1 << bits) - 1), bits)
    elif fmt in ('a8', 'l8'):
        v = b[:n]
        if fmt == 'a8':
            out[:, 3] = v
        else:
            out[:, :3] = v[:, None]
    elif fmt == 'la8':
        out[:, :3] = b[1:n * 2:2, None]
        out[:, 3] = b[0:n * 2:2]
    elif fmt in ('a4', 'l4'):
        v = np.stack([b[:n // 2] & 15, b[:n // 2] >> 4], 1).reshape(n)
        if fmt == 'a4':
            out[:, 3] = expand(v, 4)
        else:
            out[:, :3] = expand(v, 4)[:, None]
    return out


def etc(raw: bytes, w: int, h: int, alpha: bool) -> np.ndarray:
    """ETC1（ETC1A4）の 4×4 のブロックを並べ直して RGBA に展開する"""
    step = 16 if alpha else 8
    bw, bh = w // 4, h // 4
    blocks = np.frombuffer(raw[:bw * bh * step], np.uint8).reshape(-1, step)
    i = np.arange(bw * bh)
    tile, q = i // 4, i % 4
    bx = (tile % (bw // 2)) * 2 + (q & 1)
    by = (tile // (bw // 2)) * 2 + (q >> 1)
    order = np.empty(bw * bh, np.int64)
    order[by * bw + bx] = i
    color = blocks[order, -8:][:, ::-1].tobytes()
    rgba = np.frombuffer(texture2ddecoder.decode_etc1(color, w, h), np.uint8).reshape(h, w, 4)[..., [2, 1, 0, 3]].copy()
    if alpha:
        a = blocks[order, :8]
        nib = np.stack([a & 15, a >> 4], 2).reshape(-1, 16)  # 番号 = x * 4 + y
        j = np.arange(bw * bh)
        for k in range(16):
            rgba[(j // bw) * 4 + k % 4, (j % bw) * 4 + k // 4, 3] = expand(nib[:, k], 4)
    return rgba


def decode(data: bytes) -> tuple[str, Image.Image | None, int, int]:
    if data[:4] != b'TEX\0':
        raise ValueError('TEX ではない')
    _, b, c = struct.unpack_from('<III', data, 4)
    mips, w, h = b & 0x3F, (b >> 6) & 0x1FFF, (b >> 19) & 0x1FFF
    faces, code = c & 0xFF, (c >> 8) & 0xFF
    if code not in FORMATS:
        return f'?{code}', None, w, h
    fmt, bpp = FORMATS[code]
    start = 0x10 + 4 * mips * faces
    off = struct.unpack_from('<I', data, 0x10)[0]
    raw = data[start + off:start + off + w * h * bpp // 8]
    if fmt.startswith('etc'):
        img = etc(raw, w, h, fmt == 'etc1a4')
    else:
        ys, xs = z_order(w, h)
        img = np.zeros((h, w, 4), np.uint8)
        img[ys, xs] = pixels(fmt, raw, w * h)
    return fmt, Image.fromarray(img), w, h


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('src', type=Path, nargs='+')
    ap.add_argument('--out', type=Path, required=True)
    a = ap.parse_args()
    rows = []
    for src in a.src:
        for f in sorted(src.rglob('*.tex')):
            try:
                fmt, img, w, h = decode(f.read_bytes())
            except (ValueError, IndexError) as e:
                rows.append(f'{f}\t\t\t\terror: {e}')
                continue
            dest = a.out / src.name / f.relative_to(src).with_suffix('.png')
            if img is not None:
                dest.parent.mkdir(parents=True, exist_ok=True)
                img.save(dest)
            rows.append(f'{f}\t{fmt}\t{w}\t{h}\t{"ok" if img else "skip"}')
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out / 'index.tsv').write_text('file\tformat\twidth\theight\tresult\n' + '\n'.join(rows) + '\n')
    print(f'{len(rows)} 個 → {a.out}')


if __name__ == '__main__':
    main()
