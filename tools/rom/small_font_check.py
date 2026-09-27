"""書き出したフォント（PNG・JSON・寸法）だけを使って説明文の絵を描き直し、元の絵と点ごとに比べる。small_font.py から使う。

描き直しの手順（エンジンでの描き方と同じ）: 行ごとにペンを pen_x0 から advance ずつ進め、字のマスを
(ペン - cell_origin_x, 行の上端 - cell_origin_y) に置く → 字の点を shadow.offset ずらした所で、字の無い所を影にする。
名前は送りが名前ごとに違うので、字形ごとに「フォントの字形と点の並びが同じ」かだけを数える。
"""
import json
import os

import numpy as np
from PIL import Image

from small_font_seg import DESC_INK, DESC_SHADOW, DESC_TEXT_H


def load_atlas(out_dir: str, name: str) -> tuple[dict[str, np.ndarray], int]:
    meta = json.load(open(os.path.join(out_dir, name + '.json'), encoding='utf-8'))
    img = np.array(Image.open(os.path.join(out_dir, name + '.png'))) > 127
    size, cols = meta['size'], meta['columns']
    cells = {ch: img[(k // cols) * size:(k // cols + 1) * size, (k % cols) * size:(k % cols + 1) * size]
             for k, ch in enumerate(meta['chars'])}
    return cells, size


def check_desc(root: str, out_dir: str, font: dict) -> tuple[int, int, int, int]:
    """(描き直した絵の数, 元と点まで同じ数, 違う点の数, 比べた点の数)。表の形の絵（108〜115）は除く"""
    m = json.load(open(os.path.join(out_dir, 'ds-small-font.metrics.json'), encoding='utf-8'))['desc']
    cells, size = load_atlas(out_dir, m['atlas'])
    by_src: dict[str, list[int]] = {}
    for li, ln in enumerate(font['lines']):
        by_src.setdefault(ln.src, []).append(li)
    n = same = bad = total = 0
    for src, lis in by_src.items():
        if not all(font['lines'][li].grid for li in lis):
            continue
        ink = np.zeros((DESC_TEXT_H + size, 128 + size), bool)
        for li in lis:
            top = m['line_tops'][font['lines'][li].index]
            for j, i in enumerate(font['seqs'][li]):
                ch = font['dec'][i]['char'] if i is not None else ''
                if ch not in cells:
                    continue
                x = m['pen_x0'] + m['advance'] * j - m['cell_origin_x']
                y = top - m['cell_origin_y']
                ink[y:y + size, x:x + size] |= cells[ch]
        ink = ink[:DESC_TEXT_H, :128]
        dx, dy = m['shadow']['offset']
        shadow = np.zeros_like(ink)
        shadow[dy:, dx:] = ink[:ink.shape[0] - dy, :ink.shape[1] - dx]
        shadow &= ~ink
        orig = np.array(Image.open(os.path.join(root, src)))[:DESC_TEXT_H]
        want = np.where(orig == DESC_INK, 1, np.where(orig == DESC_SHADOW, 2, 0))[2:]
        got = np.where(ink, 1, np.where(shadow, 2, 0))[2:]
        diff = int((want != got).sum())
        n += 1
        same += diff == 0
        bad += diff
        total += want.size
    return n, same, bad, total


def same_shape_rate(font: dict) -> tuple[int, int]:
    """字形の出てくる場所のうち、その文字としてフォントに入れた字形と点の並びが同じものの数"""
    best: dict[str, int] = {}
    for i, d in enumerate(font['dec']):
        if len(d['char']) == 1 and (d['char'] not in best or len(font['where'][i]) > len(font['where'][best[d['char']]])):
            best[d['char']] = i
    ok = total = 0
    for i, d in enumerate(font['dec']):
        if len(d['char']) != 1:
            continue
        total += len(font['where'][i])
        ok += len(font['where'][i]) if best[d['char']] == i else 0
    return ok, total
