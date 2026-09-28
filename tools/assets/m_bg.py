"""背景（BG）・法廷のパン・机（OBJ）の計測。

背景は ARM9 の背景の表（tbl_bg_render.table_rows）の行ごとに data.bin を読み、パレットの大きさ（32 = 16 色 / 512 = 256 色）で
4bpp / 8bpp を決め、色番号の絵から色の数を数える。パックでない単独の背景（圧縮された 49664 バイト）も読む。
"""
from __future__ import annotations

import numpy as np

import bg_pan
import ex_desks
import gfx
from common import Game, bgr555, hist, indexed_colors, ratio, script_counts, sizes, stats
from databin import read_pack
from ex_tail import _unpack
from nitro import decompress
from tbl_bg_render import shape, table_rows

#: 法廷の背景の番号（弁護側・検察側・証言台・裁判長・全景・横から見た法廷）。絵を見て確かめた
COURT_IDS = {
    'aa1': {'defense': 3, 'prosecution': 4, 'witness': 5, 'judge': 8, 'overview': 6, 'side': 7},
    'aa2': {'defense': 4, 'prosecution': 5, 'witness': 6, 'judge': 7, 'overview': 9, 'side': 8},
    'aa3': {'defense': 4, 'prosecution': 5, 'witness': 6, 'judge': 7, 'overview': 9, 'side': 8},
}


def decode_bg(d: bytes, off: int, s: dict) -> tuple[np.ndarray, list[int], int, str] | None:
    """(色番号の絵, パレット, bpp, 入れ物の形) を返す。読めなければ None"""
    r = read_pack(d, off) if off else None
    if r and len(r[0]) == 7:
        parts = [_unpack(d, p, n)[0] for p, n in r[0]]
        bpp = 4 if len(parts[0]) == 32 else 8
        rows = len(parts[1]) * 8 // bpp // s['w']
        img = np.vstack([gfx.decode(b, s['w'], rows, bpp, 'tiled') for b in parts[1:]])
        return img, bgr555(parts[0]), bpp, 'pack7'
    try:
        b, _ = decompress(d, off)
    except (IndexError, KeyError):
        return None
    if len(b) == 512 + 256 * 192:
        return gfx.decode(b[512:], 256, 192, 8), bgr555(b[:512]), 8, 'single'
    if len(b) == 32 + 256 * 192 // 2:
        return gfx.decode(b[32:], 256, 192, 4), bgr555(b[:32]), 4, 'single'
    return None


def unique_tiles(img: np.ndarray, flips: bool = True) -> int:
    """8×8 のタイルの種類の数（flips = 左右・上下反転を同じとみなす。BG のマップで反転できるため）"""
    h, w = img.shape
    t = img.reshape(h // 8, 8, w // 8, 8).transpose(0, 2, 1, 3).reshape(-1, 8, 8)
    seen = set()
    for tile in t:
        keys = [tile.tobytes()]
        if flips:
            keys += [tile[:, ::-1].tobytes(), tile[::-1].tobytes(), tile[::-1, ::-1].tobytes()]
        if not any(k in seen for k in keys):
            seen.add(keys[0])
    return len(seen)


def _group(rows: list[dict]) -> dict:
    n = len(rows)
    by_bpp = {b: [r for r in rows if r['bpp'] == b] for b in (4, 8)}
    return {
        'count': n,
        'size': sizes((r['w'], r['h']) for r in rows),
        'bpp': hist(r['bpp'] for r in rows),
        'colors': stats(r['colors'] for r in rows),
        'colors_4bpp': stats(r['colors'] for r in by_bpp[4]),
        'colors_8bpp': stats(r['colors'] for r in by_bpp[8]),
        'max_index_8bpp': stats(r['max_index'] for r in by_bpp[8]),
        'share_4bpp': ratio(len(by_bpp[4]), n),
        'uses_index0': ratio(sum(r['uses_index0'] for r in rows), n),
        'unique_tiles_256x192': stats(r['unique_tiles'] for r in rows if (r['w'], r['h']) == (256, 192)),
        'container': hist(r['container'] for r in rows),
    }


def backgrounds(g: Game) -> dict:
    uses = script_counts(g.ext, 'bg')
    seen: dict[int, dict] = {}
    table = []
    for i, (off, _size, flags, _en) in enumerate(table_rows(g.arm9, g.A)):
        s = shape(flags)
        if off not in seen:
            dec = decode_bg(g.data, off, s)
            if dec is None:
                seen[off] = {}
            else:
                img, pal, bpp, kind = dec
                seen[off] = {'w': img.shape[1], 'h': img.shape[0], 'bpp': bpp, 'flag_bpp': s['bpp'],
                             'container': kind, 'kind': s['kind'], 'palette_len': len(pal),
                             'unique_tiles': unique_tiles(img), **indexed_colors(img, pal)}
        if seen[off]:
            table.append({'id': i, 'off': off, 'uses': uses.get(i, 0), **seen[off]})
    uniq = {r['off']: r for r in table}.values()
    used = {r['off']: r for r in table if r['uses']}.values()
    court = COURT_IDS[g.key]
    by_id = {r['id']: r for r in table}
    court_rows = {k: {x: by_id[i][x] for x in ('w', 'h', 'bpp', 'colors', 'indices', 'uses_index0', 'unique_tiles')}
                  for k, i in court.items() if i in by_id}
    kinds = {}
    for k in ('static', 'wide', 'tall'):
        rs = [r for r in used if r['kind'] == k]
        if rs:
            kinds[k] = _group(rs)
    court_offs = {by_id[i]['off'] for i in court.values() if i in by_id}
    others = [r for r in used if r['off'] not in court_offs]
    return {
        'table_rows': len(table_rows(g.arm9, g.A)),
        'flag_matches_palette': all(r['bpp'] == r['flag_bpp'] for r in table),
        'all_unique': _group(list(uniq)),
        'used_in_script': _group(list(used)),
        'by_kind_used': kinds,
        'others_used': _group(others),
        'court': court_rows,
    }


def pan(g: Game) -> dict:
    p, n = bg_pan.PAN_IMAGE if g.key == 'aa1' else bg_pan.PAN_23[g.A.code][0]
    b = g.data[p:p + n]
    pal = bgr555(b[:32])
    img = gfx.decode(b[32:], bg_pan.TILES_W * 8, bg_pan.TILES_H * 8, 4, 'tiled')
    return {'stored': [int(img.shape[1]), int(img.shape[0])], 'panorama': [1296, 192], 'bpp': 4,
            'compressed': False, 'palette_len': len(pal), 'mirror': 'right half = left half flipped by tile columns',
            'unique_tiles': unique_tiles(img), **indexed_colors(img, pal)}


def desks(g: Game) -> dict:
    out = {}
    for name, ((off, size), pal_off, objs) in ex_desks.desks_of(g.A.code).items():
        tiles = gfx.unpack4(g.data[off:off + size]).reshape(-1, 8, 8)
        pal = bgr555(g.data[pal_off:pal_off + 32])
        used: set[int] = set()
        for x, y, w, h, first, _flip in objs:
            idx = ex_desks.obj_image(tiles, first, w, h)[:max(0, 192 - y)]
            used |= set(np.unique(idx).tolist())
        opaque = used - {0}
        canvas = ex_desks.render(g.data, name, g.A.code)
        ys, xs = np.nonzero(canvas[..., 3])
        out[name] = {
            'bpp': 4, 'palette_len': len(pal), 'indices': len(opaque), 'colors': len({pal[i] for i in opaque}),
            'objs': [f'{w}x{h}' for _x, _y, w, h, _f, _fl in objs],
            'obj_xy': [[x, y] for x, y, *_ in objs],
            'hflip_objs': sum(1 for *_, fl in objs if fl),
            'tiles_bytes': size, 'bbox': [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
        }
    return out


def measure(g: Game) -> dict:
    return {'backgrounds': backgrounds(g), 'court_pan': pan(g), 'desks': desks(g)}
