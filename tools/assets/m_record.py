"""法廷記録（証拠品・人物ファイル）・名札・下画面の UI 部品・3D のテクスチャの計測。

- 上画面の絵（アイコン・名前・説明文・名札）は tbl_record.py が書き出した色番号の PNG（mode P）から数える
  （色番号とパレットは ROM のまま。パレットが ROM に無い名前・説明文は白黒の仮パレット）。
- 下画面の 3D のテクスチャは data.bin の見出し（databin.tex_header）から形式を読み、色番号から数える。
  同じ形のテクスチャが続けて 100 個前後並ぶ所を、置き場所と大きさから種類に分けた（TEX_GROUPS）。
- 下画面の UI 部品（OBJ）は蘇る逆転だけ（ui/index.json、tools/rom/ex_ui.py）。
"""
from __future__ import annotations

import csv
import json
import re
from itertools import groupby
from pathlib import Path

import numpy as np

import gfx
from common import (Game, bgr555, hist, indexed_colors, png_colors, png_index_info, ratio, sizes, stats,
                    summarize_colors)
from databin import TEX_BPP, tex_header

#: 続けて並ぶテクスチャの (形式, 幅, 高さ, 最低の数) → 種類
TEX_GROUPS = [
    ((3, 64, 64, 100), 'record_icon_bottom'),
    ((3, 128, 64, 100), 'record_desc_bottom'),
    ((3, 128, 16, 100), 'record_name_bottom'),
    ((3, 256, 64, 100), 'record_desc_bottom_en'),
    ((3, 128, 32, 100), 'place_name'),
    ((4, 128, 128, 40), 'move_thumbnail'),
]


def _png_rows(paths: list[Path], transparent0: bool) -> list[dict]:
    out = []
    for p in paths:
        r = png_colors(p)
        info = png_index_info(p) or {}
        if not transparent0:        # 色 0 も不透明な地の色として数える
            r['colors'] = info.get('indices_used', r['colors'])
        r['uses_index0'] = info.get('uses_index0')
        r['palette_len'] = info.get('palette_len')
        out.append(r)
    return out


def _profile_ids(g: Game) -> set[int]:
    ids: set[int] = set()
    ev = json.loads((g.ext / 'tables/evidence.json').read_text())
    ids |= {i['id'] for i in ev['items'] if i.get('start_as') == 'profile'}
    for f in (g.ext / 'script').glob('*.txt'):
        t = f.read_text(encoding='utf-8')
        ids |= {int(n) for n in re.findall(r'\[record_add profile (\d+)', t)}
        for a, b in re.findall(r'\[record_swap (\d+) (\d+)\]', t):
            ids |= {int(x) & 0x3fff for x in (a, b) if int(x) & 0x8000}
    return ids


def record(g: Game) -> dict:
    ev = json.loads((g.ext / 'tables/evidence.json').read_text())
    prof = _profile_ids(g)
    icons = {'evidence': set(), 'profile': set()}
    for it in ev['items']:
        path = ((it.get('image') or {}).get('icon') or {}).get('ja')
        if path and (g.ext / path).exists():
            icons['profile' if it['id'] in prof else 'evidence'].add(g.ext / path)
    icons['profile'] -= icons['evidence'] & icons['profile']
    out = {'table_items': len(ev['items']), 'window_icon_xywh': (ev.get('detail_window') or {}).get('icon')}
    for k, paths in icons.items():
        rows = _png_rows(sorted(paths), True)
        out[f'icon_{k}'] = {**summarize_colors(rows), 'bpp': 4, 'palette_len': hist(r['palette_len'] for r in rows),
                            'uses_index0_as_transparent': ratio(sum(bool(r['uses_index0']) for r in rows), len(rows))}
    for k in ('name', 'desc'):
        rows = _png_rows(sorted((g.ext / f'record/{k}/ja').glob('*.png')), False)
        out[k] = {**summarize_colors(rows), 'bpp': 4, 'palette': 'separate (one 16-color palette for all)'}
    rows = _png_rows(sorted((g.ext / 'record/nametag/ja').glob('*.png')), False)
    out['nametag'] = {**summarize_colors(rows), 'bpp': 4, 'layer': 'BG (6x2 tiles + bottom edge row)',
                      'y_ja': 128 if g.key != 'aa3' else None}
    ds = sorted((g.ext / 'record/icon_ds').glob('*.png'))
    if ds:
        out['icon_ds_op118'] = summarize_colors(_png_rows(ds, True))
    return out


def textures(g: Game) -> dict:
    rows = [r for r in csv.reader((g.ext / 'data/tail/index.tsv').open(encoding='utf-8'), delimiter='\t')][1:]
    tex = [int(r[0], 16) for r in rows if r[1] == 'tex']
    items = []
    for off in tex:
        t = tex_header(g.data, off)
        if not t:
            continue
        px = g.data[off + t.px_off:off + t.px_off + t.px_size]
        pal = bgr555(g.data[off + t.pal_off:off + t.pal_off + t.pal_size])
        row = {'off': off, 'fmt': t.fmt, 'w': t.w, 'h': t.h, 'palette_len': len(pal)}
        if t.fmt in (3, 4):
            idx = gfx.unpack4(px) if t.fmt == 3 else np.frombuffer(px, np.uint8)
            row.update(indexed_colors(idx[:t.w * t.h], pal))
        elif t.fmt in (1, 6):
            a = np.frombuffer(px, np.uint8)
            ib = 5 if t.fmt == 1 else 3
            row.update(indexed_colors(a & ((1 << ib) - 1), pal, False))
            row['alpha_levels'] = int(len(np.unique(a >> ib)))
        items.append(row)
    groups: dict[str, list[dict]] = {}
    for key, run in groupby(items, key=lambda r: (r['fmt'], r['w'], r['h'])):
        run = list(run)
        name = next((n for (f, w, h, m), n in TEX_GROUPS if (f, w, h) == key and len(run) >= m), None)
        groups.setdefault(name or 'misc', []).extend(run)
    first = next(groupby(items, key=lambda r: (r['fmt'], r['w'], r['h'])))
    card = list(first[1]) if first[0] == (3, 256, 64) else []
    groups['misc'] = [r for r in groups.get('misc', []) if r not in card]
    groups['episode_card'] = card

    def summ(rs: list[dict]) -> dict:
        return {'count': len(rs), 'size': sizes((r['w'], r['h']) for r in rs),
                'format': hist(f"{r['fmt']}({TEX_BPP[r['fmt']]}bpp)" for r in rs),
                'palette_len': hist(r['palette_len'] for r in rs),
                'colors': stats(r.get('colors') for r in rs),
                'uses_index0': ratio(sum(bool(r.get('uses_index0')) for r in rs), len(rs)),
                'alpha_formats': sum(1 for r in rs if r['fmt'] in (1, 6))}
    return {'total': len(items), 'format': hist(f"{r['fmt']}({TEX_BPP[r['fmt']]}bpp)" for r in items),
            'groups': {k: summ(v) for k, v in groups.items()}}


def ui_parts(g: Game) -> dict | None:
    p = g.ext / 'ui/index.json'
    if not p.exists():
        return None
    parts = json.loads(p.read_text())['parts']
    rows = [png_colors(g.ext / 'ui' / x['file']) for x in parts]
    objs = [f"{x['obj']['w']}x{x['obj']['h']}" for x in parts]
    pos = [(q['x'], q['y']) for x in parts for q in x.get('positions', [])]
    pals = json.loads((g.ext / 'ui/palettes.json').read_text()) if (g.ext / 'ui/palettes.json').exists() else {}
    return {**summarize_colors(rows), 'bpp': 4, 'obj_shape': hist(objs), 'objs_per_part': stats(
        x['obj']['cols'] * x['obj']['rows'] for x in parts), 'palettes_16color': len(pals) if isinstance(pals, (dict, list)) else None,
        'position_on_8px_grid': ratio(sum(x % 8 == 0 and y % 8 == 0 for x, y in pos), len(pos)),
        'confidence': hist(x.get('palette_confidence') for x in parts)}


def measure(g: Game) -> dict:
    return {'record': record(g), 'textures': textures(g), 'ui_parts_bottom': ui_parts(g)}
