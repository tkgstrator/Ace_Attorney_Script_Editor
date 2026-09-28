"""人物のパック（OBJ のアニメーション）の計測: 人物の立ち絵・吹き出し・カットイン・重ね絵（47 anim）・2・3 の錠の絵など。

人物のパック（ex_chars.py）の 1 組 = 画像（パレット n 枚 + 部品の 4bpp タイル）+ 動き（区間ごとのコマ送り、コマ = OAM の部品の並び）。
組の番号の分け方（CATEGORIES）は、組ごとの最初のコマを並べた一覧（data/tail/chars/<位置>/_sheet.png）を見て決めた。
人物 = tables/chars.json の files。重ね絵 = tables/anims47.json の pack（ほかの分類に入らないもの）。
"""
from __future__ import annotations

import json
import struct

import numpy as np

import ex_chars
import gfx
from common import Game, bgr555, hist, ratio, stats
from databin import read_pack
from ex_tail import _unpack

#: 組の番号の分け方（作品ごと）。bubble = 異議あり・待った・くらえ（日本語と英語）、testimony = 証言開始・尋問開始の文字、
#: cutin = 顔の大写し、lock = サイコ・ロックの錠（大・小）、unlock = 解除の文字、burst = 錠が壊れるときの光
CATEGORIES = {
    'aa1': {'bubble': range(157, 165), 'testimony': (155, 156), 'cutin': (74, 75)},
    'aa2': {'bubble': range(143, 151), 'testimony': (141, 142), 'cutin': (108, 109, 111),
            'lock': (154, 155), 'unlock': (157, 158), 'burst': (156,)},
    'aa3': {'bubble': range(167, 175), 'testimony': (165, 166), 'cutin': (129, 130, 132, 133),
            'lock': (178, 179), 'unlock': (181, 182), 'burst': (180,)},
}


def blocks_of(g: Game) -> dict[int, set[int]]:
    """組の番号 → 動きのデータの中の区間の位置（char_anims.json と anims47.json から）"""
    out: dict[int, set[int]] = {}
    ca = json.loads((g.ext / 'tables/char_anims.json').read_text())['anims']
    for a in ca.values():
        out.setdefault(int(a['file']), set()).add(int(a['block_offset']))
    for a in json.loads((g.ext / 'tables/anims47.json').read_text())['anims']:
        for e in (a, a.get('en') or {}):
            if 'pack' in e:
                out.setdefault(int(e['pack']), set()).add(int(e.get('offset', 0)))
    return out


def frames_in(b: bytes, blocks: set[int]) -> tuple[dict[int, list], list[int]]:
    """区間ごとのコマ送りから、コマ（位置 → 部品の一覧）と長さの一覧を集める"""
    frames: dict[int, list] = {}
    durs: list[int] = []
    for base in sorted(blocks | {0}):
        if base + 8 > len(b):
            continue
        m = struct.unpack_from('<H', b, base + 2)[0]
        for i in range(m):
            q = base + 8 + 8 * i
            if q + 4 > len(b):
                break
            off, dur = struct.unpack_from('<HB', b, q)
            durs.append(dur)
            a = base + off
            if a in frames or a + 4 > len(b):
                continue
            k = struct.unpack_from('<H', b, a)[0]
            frames[a] = [struct.unpack_from('<bbBB', b, a + 4 + 4 * j) for j in range(k) if a + 8 + 4 * j <= len(b)]
    return frames, durs


def measure_entry(gfx_b: bytes, anim_b: bytes, blocks: set[int]) -> dict | None:
    try:
        npal = struct.unpack_from('<I', gfx_b, 0)[0] & 0xff
        pals = [bgr555(gfx_b[4 + 32 * i:36 + 32 * i]) for i in range(npal)]
        _, cells = ex_chars.parse_gfx(gfx_b)
        frames, durs = frames_in(anim_b, blocks)
    except (struct.error, IndexError, ValueError):
        return None
    used: set[tuple[int, int]] = set()
    shapes, per_frame, boxes, aligned, pals_used = [], [], [], 0, set()
    total = 0
    for pieces in frames.values():
        ok = [(x, y, i, attr) for x, y, i, attr in pieces if ex_chars.OAM_SIZE.get(attr >> 4) and i < len(cells)]
        if not ok:
            continue
        per_frame.append(len(ok))
        x0 = y0 = 10 ** 6
        x1 = y1 = -10 ** 6
        for x, y, i, attr in ok:
            w, h = ex_chars.OAM_SIZE[attr >> 4]
            shapes.append(f'{w}x{h}')
            p = min((attr & 15) * npal // 16, npal - 1)
            pals_used.add(p)
            if len(cells[i]) * 2 >= w * h:
                for v in np.unique(gfx.unpack4(cells[i])[:w * h]).tolist():
                    if v:
                        used.add((p, v))
            aligned += (x % 8 == 0 and y % 8 == 0)
            total += 1
            x0, y0, x1, y1 = min(x0, x), min(y0, y), max(x1, x + w), max(y1, y + h)
        boxes.append((x1 - x0, y1 - y0))
    if not per_frame:
        return None
    colors = {pals[p][v] for p, v in used if p < len(pals) and v < len(pals[p])}
    per_pal = [len({pals[p][v] for q, v in used if q == p}) for p in sorted(pals_used)]
    return {'palettes': npal, 'palettes_used': len(pals_used), 'colors': len(colors), 'colors_per_palette': per_pal,
            'frames': len(per_frame), 'objs_per_frame': max(per_frame), 'shapes': shapes,
            'box': max(boxes, key=lambda s: s[0] * s[1]), 'aligned8': ratio(aligned, total), 'durs': durs}


def _summary(rows: list[dict]) -> dict:
    if not rows:
        return {'count': 0}
    return {
        'count': len(rows),
        'palettes': stats(r['palettes'] for r in rows),
        'palettes_used': stats(r['palettes_used'] for r in rows),
        'colors': stats(r['colors'] for r in rows),
        'colors_per_palette': stats(c for r in rows for c in r['colors_per_palette']),
        'colors_le15': ratio(sum(r['colors'] <= 15 for r in rows), len(rows)),
        'frames': stats(r['frames'] for r in rows),
        'objs_per_frame_max': stats(r['objs_per_frame'] for r in rows),
        'obj_shapes': hist((s for r in rows for s in r['shapes']), 12),
        'box': hist((f'{r["box"][0]}x{r["box"][1]}' for r in rows), 8),
        'box_w': stats(r['box'][0] for r in rows),
        'box_h': stats(r['box'][1] for r in rows),
        'obj_xy_on_8px_grid': stats(r['aligned8'] for r in rows),
        'frame_duration': stats(d for r in rows for d in r['durs'] if d < 0xfd),
    }


def measure(g: Game) -> dict:
    ents, _ = read_pack(g.data, g.A.char_pack)
    parts = [_unpack(g.data, p, n)[0] for p, n in ents]
    blocks = blocks_of(g)
    rows = {}
    for k in range(len(parts) // 2):
        r = measure_entry(parts[2 * k], parts[2 * k + 1], blocks.get(k, set()))
        if r:
            rows[k] = r
    chars = json.loads((g.ext / 'tables/chars.json').read_text())['chars']
    char_files = {int(f) for c in chars.values() for f in c.get('files', [])}
    anims47 = json.loads((g.ext / 'tables/anims47.json').read_text())['anims']
    a47 = {int(e['pack']) for a in anims47 for e in (a, a.get('en') or {}) if 'pack' in e}
    cats = {k: set(v) for k, v in CATEGORIES[g.key].items()}
    special = set().union(*cats.values())
    groups = {'character': sorted(char_files - special), **{k: sorted(v) for k, v in cats.items()},
              'overlay_anims47': sorted(a47 - special - char_files)}
    placed = set().union(*map(set, groups.values()))
    groups['other'] = sorted(set(rows) - placed)
    out = {'pack_entries': len(parts) // 2, 'bpp': 4, 'compression': 'per-part 16-bit RLE',
           'groups': {k: _summary([rows[i] for i in v if i in rows]) for k, v in groups.items()}}
    out['anims47'] = anims47_summary(anims47)
    out['character_position'] = hist(f"{c['pos']['x']},{c['pos']['y']}" for c in chars.values() if c.get('pos'))
    out['character_oam_max'] = hist(c.get('oam_max') for c in chars.values())
    return out


def anims47_summary(anims: list[dict]) -> dict:
    """47 anim の表: 画面の上の原点・下画面か・長さ・終わり方"""
    return {
        'count': len(anims),
        'origin': hist((f'{a["x"]},{a["y"]}' for a in anims), 8),
        'bottom_screen': sum(1 for a in anims if a.get('bottom_screen')),
        'total_frames': stats(a.get('total_frames') for a in anims if isinstance(a.get('total_frames'), int)),
        'end': hist(a.get('end') for a in anims),
        'has_en_variant': sum(1 for a in anims if a.get('en') and a['en'].get('pack') != a.get('pack')),
    }
