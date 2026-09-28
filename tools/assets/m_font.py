"""フォントの計測: 本文の字（ROM の 16×16 の字形）と、法廷記録の小さい字（蘇る逆転だけ。絵から切り出したもの）。

本文の字は dsfont.find_font で ROM から探し、字ごとの点の範囲（幅・高さ・上端・下端）と点の値（色番号）を数える。
送り幅・行の高さ・文字の色は tables/engine.json（蘇る逆転の ARM9 から読んだ値）。
小さい字は font/ds-small-font.metrics.json（tools/rom/small_font.py が絵から測った値）と、字形の数。
"""
from __future__ import annotations

import json
from collections import Counter

import numpy as np

import dsfont
from common import Game, hist, stats


def body_font(g: Game) -> dict:
    start, count = dsfont.find_font(g.rom)
    values: Counter = Counter()
    w, h, top, bottom, left = [], [], [], [], []
    for i in range(count):
        cell = np.array(dsfont.decode(g.rom, start + i * dsfont.GLYPH_BYTES))
        values.update(cell[cell > 0].tolist())
        ys, xs = np.nonzero(cell)
        if not len(xs):
            continue
        w.append(int(xs.max() - xs.min() + 1))
        h.append(int(ys.max() - ys.min() + 1))
        top.append(int(ys.min()))
        bottom.append(int(ys.max()))
        left.append(int(xs.min()))
    out = {'cell': [16, 16], 'bpp': 4, 'layout': '4 tiles of 8x8 (TL, TR, BL, BR)', 'glyphs': count,
           'pixel_values': dict(sorted((str(k), v) for k, v in values.items())),
           'ink_width': stats(w), 'ink_height': stats(h), 'ink_top': stats(top), 'ink_bottom': stats(bottom),
           'ink_left': stats(left), 'ink_width_hist': hist(w, 8)}
    eng = g.ext / 'tables/engine.json'
    if eng.exists():
        t = json.loads(eng.read_text())['text']
        out['engine'] = {'advance_ja': t['advance_px']['ja'], 'line_height': t['line_height_px'],
                         'max_chars_per_line': t['max_chars_per_line'], 'origin': [t['origin']['x'], t['origin']['y_ja']],
                         'text_colors': len([k for k in t['colors'] if k.isdigit()])}
    return out


def small_fonts(g: Game) -> dict | None:
    root = g.ext / 'font'
    m = root / 'ds-small-font.metrics.json'
    if g.key != 'aa1' or not m.exists():
        return None
    metrics = json.loads(m.read_text())
    out = {}
    for key, atlas in (('desc', 'ds-small-font'), ('name', 'ds-small-name-font'), ('profile', 'ds-small-profile-name-font')):
        mm = metrics[key]
        chars = json.loads((root / f'{atlas}.json').read_text())['chars']
        out[key] = {'cell': mm['cell'], 'advance': mm['advance'], 'glyph_h': mm['glyph_h'],
                    'line_pitch': mm.get('line_pitch'), 'lines': mm.get('lines'),
                    'max_chars_per_line': mm.get('max_chars_per_line'), 'glyphs': len(chars),
                    'shadow': bool(mm.get('shadow')), 'ink_colors': 1 + bool(mm.get('shadow'))}
    return out


def measure(g: Game) -> dict:
    return {'body': body_font(g), 'small': small_fonts(g)}
