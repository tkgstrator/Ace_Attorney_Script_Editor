"""data.bin の構造の読み取り。

data.bin は目次を持たず、次の 3 種類のものが 4 バイト境界で並んでいる。

- パック: u32 個数 N、続いて N 組の (u32 位置, u32 大きさ)。位置はパックの先頭から数える。
  先頭の 8 個（通し番号 0-7）は大きな画像アーカイブで、ARM9 の表（0x10000|個数, 展開後の大きさ, 位置）
  からも参照されている
- 圧縮データ: DS 標準の LZ77 (0x10) / LZ11 (0x11) / RLE (0x30)
- テクスチャ: 20 バイトの見出し (u8 形式, u8 log2(幅/8), u8 log2(高さ/8), u8 0,
  u32 画素の位置 = 0x14, u32 画素の大きさ, u32 パレットの位置, u32 パレットの大きさ) + 画素 + パレット。
  形式は DS の 3D テクスチャの番号（3 = 16 色、4 = 256 色、6 = A5I3 など）で、画素は線形に並ぶ
"""
import struct
from dataclasses import dataclass

from nitro import COMPRESSION_TYPES, decompress

ARCHIVE_COUNT = 8        # 先頭に並ぶ画像アーカイブの数
TEX_BPP = {1: 8, 2: 2, 3: 4, 4: 8, 5: 2, 6: 8, 7: 16}   # テクスチャ形式ごとの 1 画素のビット数


@dataclass
class Item:
    kind: str            # 'pack' / 'blob' / 'tex'
    offset: int          # data.bin 内の位置
    size: int            # data.bin 上での大きさ
    info: object = None  # pack: [(絶対位置, 大きさ)], blob: 展開後の大きさ, tex: TexHeader


@dataclass
class TexHeader:
    fmt: int
    w: int
    h: int
    px_off: int
    px_size: int
    pal_off: int
    pal_size: int

    @property
    def total(self) -> int:
        return max(self.px_off + self.px_size, self.pal_off + self.pal_size)


def read_pack(d: bytes, base: int, max_count: int = 4096):
    """base からパックとして読めれば [(絶対位置, 大きさ)] と全体の大きさを返す。読めなければ None"""
    if base + 4 > len(d):
        return None
    n = struct.unpack_from('<I', d, base)[0]
    if not 1 <= n <= max_count or base + 4 + 8 * n > len(d):
        return None
    ents = [struct.unpack_from('<II', d, base + 4 + 8 * k) for k in range(n)]
    end = 4 + 8 * n
    if ents[0][0] != end:
        return None
    for off, size in ents:
        if off < end or off - end > 3 or size == 0:
            return None
        end = off + size
    if base + end > len(d):
        return None
    return [(base + o, s) for o, s in ents], end


def tex_header(d: bytes, p: int):
    """p にテクスチャの見出しがあれば TexHeader を返す"""
    if p + 20 > len(d) or d[p + 3] != 0 or d[p] not in TEX_BPP or d[p + 1] > 7 or d[p + 2] > 7:
        return None
    px_off, px_size, pal_off, pal_size = struct.unpack_from('<4I', d, p + 4)
    w, h = 8 << d[p + 1], 8 << d[p + 2]
    if px_off != 0x14 or px_size != w * h * TEX_BPP[d[p]] // 8:
        return None
    if pal_off != px_off + px_size or pal_size > 0x200 or pal_size % 4:
        return None
    t = TexHeader(d[p], w, h, px_off, px_size, pal_off, pal_size)
    return t if p + t.total <= len(d) else None


def try_blob(d: bytes, p: int):
    """p に DS 標準の圧縮データがあれば (読んだバイト数, 展開後の大きさ) を返す。
    展開後の大きさが 4 の倍数でないものは、ほぼ誤検出なので捨てる"""
    if p + 4 > len(d) or d[p] not in COMPRESSION_TYPES:
        return None
    size = struct.unpack_from('<I', d, p)[0] >> 8
    if not 16 <= size <= 0x200000 or size % 4:
        return None
    try:
        out, used = decompress(d, p)
    except (IndexError, KeyError):
        return None
    return (used, size) if len(out) == size else None


def walk(d: bytes) -> list[Item]:
    """data.bin を先頭から順に、パック・テクスチャ・圧縮データとして読める所を拾っていく。
    どれにも当てはまらない所は 4 バイトずつ飛ばす（未解明の領域）"""
    items: list[Item] = []
    p = 0
    while p < len(d) - 4:
        r = read_pack(d, p)
        if r:
            items.append(Item('pack', p, r[1], r[0]))
            p = (p + r[1] + 3) & ~3
            continue
        t = tex_header(d, p)
        if t:
            items.append(Item('tex', p, t.total, t))
            p = (p + t.total + 3) & ~3
            continue
        b = try_blob(d, p)
        if b:
            items.append(Item('blob', p, b[0], b[1]))
            p = (p + b[0] + 3) & ~3
            continue
        p += 4
    return items


def gaps(items: list[Item], total: int, min_size: int = 256) -> list[tuple[int, int]]:
    """どれにも当てはまらなかった領域 (位置, 大きさ) の一覧"""
    out, prev = [], 0
    for it in items:
        if it.offset - prev >= min_size:
            out.append((prev, it.offset - prev))
        prev = max(prev, (it.offset + it.size + 3) & ~3)
    if total - prev >= min_size:
        out.append((prev, total - prev))
    return out


# ---- ARM9 の中の表 ----

def _cstr(a: bytes, ptr: int):
    o = ptr - 0x02000000   # ARM9 は 0x02000000 に置かれる
    if not 0 <= o < len(a):
        return None
    e = a.find(b'\0', o)
    t = a[o:e]
    if len(t) < 3 or not all(32 < c < 127 for c in t):
        return None
    return t.decode()


def named_resources(a: bytes, data_size: int) -> dict[int, str]:
    """ARM9 の中の (u32 名前へのポインタ, u32 位置, u32 大きさ) の組を探し、位置 → 名前 の辞書を返す"""
    out: dict[int, str] = {}
    for i in range(0, len(a) - 12, 4):
        ptr, off, size = struct.unpack_from('<3I', a, i)
        if 0x02000000 <= ptr < 0x02000000 + len(a) and 0 < off < data_size and 0 < size < 0x400000 \
                and off + size <= data_size:
            name = _cstr(a, ptr)
            if name and '/' not in name and off not in out:
                out[off] = name
    return out


def bg_table(a: bytes, packs: set[int]) -> dict[int, int]:
    """背景の表（16 バイト: u32 位置, u32 大きさ, u32 フラグ, u32 0x8000）を探し、位置 → 表の中の番号 を返す"""
    out: dict[int, int] = {}
    for i in range(0, len(a) - 16, 4):
        off, size, _flags, tail = struct.unpack_from('<4I', a, i)
        if tail == 0x8000 and off in packs and off not in out:
            out[off] = len(out)
    return out
