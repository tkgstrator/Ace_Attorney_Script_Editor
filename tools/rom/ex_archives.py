"""data.bin の先頭に並ぶ 8 個の画像アーカイブの書き出し。

どのアーカイブも「パック」形式（u32 個数、(u32 位置, u32 大きさ) の組）で、中身はすべて DS 標準の圧縮データ。
ARM9 の中にも同じ情報の表がある（0x10000|個数, 展開後の大きさ, 位置）。

    0: 450 個  RLE   → 20512 バイト = パレット 32 バイト + 4bpp タイル 256×160
    1: 329 個  RLE   → 24608 バイト = パレット 32 バイト + 4bpp タイル 256×192
    2: 1420 個 LZ77  → 24608 バイト（同上）
    3: 270 個  LZ77  → 24608 バイト（同上）
    4-7: 498/22/61/51 個 RLE → 6144 バイト = 1bpp 256×192 のマスク（下位ビットが左）
"""
from pathlib import Path

import gfx
from databin import read_pack
from nitro import decompress

# (幅, 高さ, bpp, パレットの大きさ)
LAYOUTS = {
    20512: (256, 160, 4, 32),
    24608: (256, 192, 4, 32),
    6144: (256, 192, 1, 0),
}


def archive_offsets(d: bytes, count: int = 8) -> list[int]:
    """先頭から続くアーカイブの位置の一覧（次のアーカイブは前のものの末尾を 4 バイトに揃えた所から始まる）"""
    out, p = [], 0
    for _ in range(count):
        ents, end = read_pack(d, p)
        out.append(p)
        p = (p + end + 3) & ~3
    return out


def decode_entry(b: bytes):
    """展開済みのデータを (インデックス配列, パレット) にする。形式が分からなければ None"""
    lay = LAYOUTS.get(len(b))
    if not lay:
        return None
    w, h, bpp, pal_size = lay
    if bpp == 1:
        return gfx.decode(b, w, h, 1, 'linear'), [(0, 0, 0), (255, 255, 255)]
    return gfx.decode(b[pal_size:], w, h, bpp, 'tiled'), gfx.palette(b[:pal_size])


def export(d: bytes, out: Path, raw: bool = True, sheets: bool = True) -> dict:
    """アーカイブをすべて書き出し、アーカイブ番号 → 書き出した画像の数 を返す"""
    summary = {}
    for n, base in enumerate(archive_offsets(d)):
        dst = out / f'archive{n}'
        dst.mkdir(parents=True, exist_ok=True)
        ents, _ = read_pack(d, base)
        pngs, empty = [], 0
        for i, (p, _size) in enumerate(ents):
            b, _ = decompress(d, p)
            if raw:
                (dst / f'{i:04}.bin').write_bytes(b)
            r = decode_entry(b)
            if r is None:
                continue
            idx, pal = r
            if not idx.any():          # 空のマスクは画像にしない
                empty += 1
                continue
            path = dst / f'{i:04}.png'
            gfx.write_png(path, idx, pal)
            pngs.append(path)
        if sheets:
            gfx.contact_sheet(pngs, dst / '_sheet.png', cols=16, cell=96)
        summary[n] = (len(ents), len(pngs), empty)
        print(f'  archive{n}: {len(ents)} 個 → 画像 {len(pngs)} 枚（空 {empty}）')
    return summary
