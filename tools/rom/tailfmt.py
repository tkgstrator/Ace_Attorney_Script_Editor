"""data.bin の後半に出てくる個々の形式の画像化。

どの関数も PNG を書き出して True を返す。形式が当てはまらなければ False を返す（何も書かない）。
"""
import struct

import numpy as np

import gfx
from databin import TEX_BPP, tex_header


def texture(b: bytes, path) -> bool:
    """テクスチャ（見出し 20 バイト + 線形の画素 + パレット）。パレットが複数あるときは先頭のものを使い、
    色番号 0 は透明にする（DS の 3D では多くの場合そう設定される）"""
    t = tex_header(b, 0)
    if not t:
        return False
    px = b[t.px_off:t.px_off + t.px_size]
    pal = gfx.palette(b[t.pal_off:t.pal_off + t.pal_size])
    bpp = TEX_BPP[t.fmt]
    if t.fmt in (2, 3, 4):            # 4 色 / 16 色 / 256 色
        a = np.frombuffer(px, np.uint8)
        if bpp == 2:
            idx = np.stack([(a >> s) & 3 for s in (0, 2, 4, 6)], 1).reshape(-1)
        elif bpp == 4:
            idx = gfx.unpack4(px)
        else:
            idx = a
        n = 1 << bpp
        gfx.write_png(path, idx[:t.w * t.h].reshape(t.h, t.w), (pal[:n] or gfx.gray(bpp)), transparent0=True)
        return True
    if t.fmt in (1, 6):               # A3I5 / A5I3（半透明つき）
        a = np.frombuffer(px, np.uint8)[:t.w * t.h]
        ib, ab = (5, 3) if t.fmt == 1 else (3, 5)
        idx = a & ((1 << ib) - 1)
        alpha = (a >> ib).astype(np.uint16) * 255 // ((1 << ab) - 1)
        pal = np.array((pal + [(255, 0, 255)] * 32)[:32], np.uint8)
        rgba = np.zeros((t.h * t.w, 4), np.uint8)
        rgba[:, :3] = pal[idx]
        rgba[:, 3] = alpha
        gfx.write_rgba_png(path, rgba.reshape(t.h, t.w, 4))
        return True
    if t.fmt == 7:                    # 直接色（BGR555 + 不透明ビット）
        c = np.frombuffer(px, '<u2')[:t.w * t.h]
        rgba = np.stack([(c & 31) * 255 // 31, (c >> 5 & 31) * 255 // 31, (c >> 10 & 31) * 255 // 31,
                         (c >> 15) * 255], 1).astype(np.uint8)
        gfx.write_rgba_png(path, rgba.reshape(t.h, t.w, 4))
        return True
    return False


def bg_pack(parts: list[bytes], path) -> bool:
    """背景のパック: [パレット（32 = 16 色 / 512 = 256 色）, 横 32 画素ずつの帯 × 6 ...]。
    帯は 4bpp なら 4096 バイト（256×32）、8bpp なら 8192 バイト（256×32）か 16384 バイト（512×32）"""
    if len(parts) < 2 or len(parts[0]) not in (32, 512):
        return False
    bpp = 4 if len(parts[0]) == 32 else 8
    strips = []
    for s in parts[1:]:
        n = len(s) * 8 // bpp
        w = 512 if n == 512 * 32 else 256
        if n % (w * 8):
            return False
        strips.append(gfx.decode(s, w, n // w, bpp, 'tiled'))
    w = max(s.shape[1] for s in strips)
    strips = [np.pad(s, ((0, 0), (0, w - s.shape[1]))) for s in strips]
    gfx.write_png(path, np.vstack(strips), gfx.palette(parts[0]))
    return True


def full_bg(b: bytes, path) -> bool:
    """単独の背景: 512 バイトのパレット + 8bpp タイル 256×192（49664 バイト）、
    または 32 バイトのパレット + 4bpp タイル 256×192（24608 バイト）"""
    if len(b) == 512 + 256 * 192:
        gfx.write_png(path, gfx.decode(b[512:], 256, 192, 8), gfx.palette(b[:512]))
        return True
    if len(b) == 32 + 256 * 192 // 2:
        gfx.write_png(path, gfx.decode(b[32:], 256, 192, 4), gfx.palette(b[:32]))
        return True
    return False


def gray_bitmap(b: bytes, path) -> bool:
    """パレットの無い 8bpp の線形 256×192（49152 バイト）。スタッフロールの文字やスポットライトの形など。
    明るさを引き伸ばした白黒で書く"""
    if len(b) != 256 * 192:
        return False
    a = np.frombuffer(b, np.uint8).reshape(192, 256)
    top = max(int(a.max()), 1)
    gfx.write_png(path, (a.astype(np.uint16) * 255 // top).astype(np.uint8), gfx.gray(8))
    return True


def profile_text(b: bytes, path) -> bool:
    """法廷記録の説明文（4096 バイト = 4bpp、64×32 の OBJ ブロック 4 個）。
    ブロック k の上半分が (k//2 列目, 2*(k%2) 行目)、下半分が (k//2 列目, 2*(k%2)+1 行目) の 16 画素の行になる"""
    if len(b) != 4096:
        return False
    blocks = gfx.obj_blocks(gfx.unpack4(b), 256, 32, 64, 32)
    out = np.zeros((64, 128), np.uint8)
    for k in range(4):
        blk = blocks[:, 64 * k:64 * k + 64]
        x = 64 * (k // 2)
        y = 32 * (k % 2)
        out[y:y + 32, x:x + 64] = blk
    gfx.write_png(path, out, gfx.gray(4))
    return True


def name_label(b: bytes, path) -> bool:
    """法廷記録の名前（1024 バイト = 4bpp、32×16 の OBJ ブロック 4 個を横に並べた 128×16）"""
    if len(b) != 1024:
        return False
    gfx.write_png(path, gfx.obj_blocks(gfx.unpack4(b), 128, 16, 32, 16), gfx.gray(4))
    return True


def is_char_pack(parts: list[bytes]) -> bool:
    """キャラクターのパック: (画像, 動き) の組が並ぶ。画像は u32 (0x80000000 | パレット数) で始まる"""
    return len(parts) >= 4 and len(parts) % 2 == 0 and all(
        struct.unpack_from('<I', parts[i], 0)[0] >> 24 == 0x80 for i in range(0, len(parts), 2))
