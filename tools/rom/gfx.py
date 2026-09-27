"""DS のグラフィック形式の展開と PNG の書き出し（numpy を使う）。

- 色: BGR555（1 色 2 バイト、ビット 0-4 = 赤、5-9 = 緑、10-14 = 青）
- 4bpp: 1 バイトに 2 画素。下位 4 ビットが左の画素
- タイル: 8×8 画素。4bpp なら 32 バイト、8bpp なら 64 バイト
- 「タイル並び」は 2D の BG と同じく、タイルを左上から横方向に並べる
- 「線形」は 3D テクスチャと同じく、画素を左上から 1 行ずつ並べる

PNG は外部コマンドを使わず zlib で直接書く（インデックスカラー形式）。
"""
import struct
import subprocess
import zlib

import numpy as np

# 一覧画像のラベル用のフォント（macOS に標準で入っているもの）
FONT = '/System/Library/Fonts/Geneva.ttf'


def palette(b: bytes) -> list[tuple[int, int, int]]:
    """BGR555 のパレットを (R, G, B) の一覧にする"""
    c = np.frombuffer(bytes(b[:len(b) // 2 * 2]), '<u2')
    r, g, bl = c & 31, (c >> 5) & 31, (c >> 10) & 31
    return [(int(x) * 255 // 31, int(y) * 255 // 31, int(z) * 255 // 31) for x, y, z in zip(r, g, bl)]


def gray(bits: int) -> list[tuple[int, int, int]]:
    """パレットが分からないときの白黒の仮パレット"""
    n = 1 << bits
    return [(i * 255 // (n - 1),) * 3 for i in range(n)]


def unpack4(b: bytes) -> np.ndarray:
    """4bpp のバイト列を 1 画素 1 バイトの配列にする"""
    a = np.frombuffer(bytes(b), np.uint8)
    out = np.empty(a.size * 2, np.uint8)
    out[0::2] = a & 15
    out[1::2] = a >> 4
    return out


def unpack1(b: bytes) -> np.ndarray:
    """1bpp（下位ビットが左）を 1 画素 1 バイトの配列にする"""
    return np.unpackbits(np.frombuffer(bytes(b), np.uint8), bitorder='little')


def tiled(px: np.ndarray, w: int, h: int) -> np.ndarray:
    """8×8 タイルを横方向に並べた画素列を、h×w の 2 次元配列にする"""
    px = px[:w * h]
    return px.reshape(h // 8, w // 8, 8, 8).transpose(0, 2, 1, 3).reshape(h, w)


def linear(px: np.ndarray, w: int, h: int) -> np.ndarray:
    return px[:w * h].reshape(h, w)


def decode(b: bytes, w: int, h: int, bpp: int, layout: str = 'tiled') -> np.ndarray:
    """画素データを h×w のインデックス配列にする"""
    px = unpack4(b) if bpp == 4 else unpack1(b) if bpp == 1 else np.frombuffer(bytes(b), np.uint8)
    return (tiled if layout == 'tiled' else linear)(px, w, h)


def _chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))


def write_png(path, idx: np.ndarray, pal: list, transparent0: bool = False) -> None:
    """インデックス配列とパレットから 8bit インデックスカラーの PNG を書く"""
    h, w = idx.shape
    pal = list(pal)[:256] or gray(8)
    if int(idx.max(initial=0)) >= len(pal):
        pal = pal + [(255, 0, 255)] * (int(idx.max()) + 1 - len(pal))
    raw = np.zeros((h, w + 1), np.uint8)
    raw[:, 1:] = idx
    png = b'\x89PNG\r\n\x1a\n'
    png += _chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 3, 0, 0, 0))
    png += _chunk(b'PLTE', b''.join(bytes(c) for c in pal))
    if transparent0:
        png += _chunk(b'tRNS', b'\x00')
    png += _chunk(b'IDAT', zlib.compress(raw.tobytes(), 9))
    png += _chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def write_rgba_png(path, rgba: np.ndarray) -> None:
    """RGBA（h×w×4）の PNG を書く"""
    h, w, _ = rgba.shape
    raw = np.zeros((h, w * 4 + 1), np.uint8)
    raw[:, 1:] = rgba.reshape(h, w * 4)
    png = b'\x89PNG\r\n\x1a\n'
    png += _chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
    png += _chunk(b'IDAT', zlib.compress(raw.tobytes(), 9))
    png += _chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def contact_sheet(paths: list, out, cols: int = 10, cell: int = 128, labels: list | None = None) -> None:
    """一覧用の縮小画像を ImageMagick の montage で作る（ラベルは labels、無ければファイル名）。
    容量を抑えるため 256 色に減色する"""
    if not paths:
        return
    for i in range(0, len(paths), 400):   # 1 枚が大きくなりすぎないよう 400 枚ずつ
        if labels:          # 1 枚ずつラベルを付けるのは遅いので、指定されたときだけ
            args = [a for p, lab in zip(paths[i:i + 400], labels[i:i + 400]) for a in ('-label', lab, str(p))]
        else:
            args = [*map(str, paths[i:i + 400]), '-set', 'label', '%t']
        dst = str(out) if len(paths) <= 400 else str(out).replace('.png', f'_{i // 400}.png')
        subprocess.run(['magick', 'montage', '-font', FONT, '-pointsize', '10', *args,
                        '-tile', f'{cols}x', '-geometry', f'{cell}x{cell}+2+2',
                        '-background', '#404040', '-fill', 'white', dst], check=True)
        subprocess.run(['magick', dst, '+dither', '-colors', '256', dst], check=True)   # 別の手順で減色する方が速い


def obj_blocks(px: np.ndarray, w: int, h: int, bw: int, bh: int) -> np.ndarray:
    """OBJ の 1D マッピング: bw×bh のブロックごとにタイルが連続して並ぶ。
    ブロックを左上から横方向に並べて h×w の配列にする"""
    n = (w // bw) * (h // bh)
    b = tiled(px[:w * h], bw, bh * n)          # ブロックを縦に積んだ画像
    b = b.reshape(h // bh, w // bw, bh, bw).transpose(0, 2, 1, 3)
    return b.reshape(h, w)
