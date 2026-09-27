# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "pillow>=10"]
# ///
"""法廷記録の名前・説明文（tables/record_text.json）を小さいフォントで描き直し、元の絵と点ごとに比べる。

    uv run tools/rom/record_text_check.py [record_text.json]

項目ごとに、読んだ文字列の字をフォントの PNG（ds-small-*.png）の字形で描き直して、元の絵（record/desc/ja・record/name/ja）の
字の点と比べる。説明文は影も描いて比べる。字の置き方:
  - 説明文（ふつうの 3 行）: エンジンと同じ並べ方（ds-small-font.metrics.json の pen_x0 + advance × 並びの番号）。空きマスも位置で比べる
  - 名前・表の形の説明文（108〜115）: 送りが決まらないので、元の絵の字の位置（切り出した字形の左端）に置く
元の絵の字は同じ文字でも 1〜2 点違う描き方（異体）がある。一致しない字は、元の絵の字形とフォントの字形の
食い違う点の数（上下左右 1 点までずらした最小）を、フォントのほかの全部の字とも比べて:
  - 読んだ字がいちばん近く、食い違いが少ない（VARIANT_MAX 以下）→ 異体として通す（一覧には数だけ）
  - 目で見て文字を確かめた字形（tools/rom/small_font_fixes.tsv に載っている字形、tools/rom/record_text_fixes.json で
    直した場所）で、読んだ字がその文字なら「目で確かめた異体」として通す（一覧には数だけ）
  - そうでなければ「一致しない」として一覧に出す（ほかの字のほうが近ければ、その字を候補に出す）
出力: font/small/record_check.txt（一致しないものの一覧と数）。一致しないものが無ければ終了コード 0。
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from record_glyphs import (  # noqa: E402
    X,
    align_dist,
    ink_of,
    items,
    load_fonts,
    make_shadow,
    metrics,
    paint,
    record_lines,
    shadow_of,
)
from record_text import read_fixes  # noqa: E402
from small_font_seg import NAME_TOP  # noqa: E402

#: 異体として通す食い違いの点の数（字の点の数の 1/8 か 3 の大きいほう）
VARIANT_MAX_MIN = 3


class Checker:
    def __init__(self):
        self.fonts = load_fonts()
        self.m = metrics()['desc']
        self.lines = record_lines()
        #: 直し表で直した場所（画像:行:並びの番号）→ 文字
        self.fixed_at: dict[str, str] = {}
        its = {it['id']: it for it in items()}
        for (rec, fld), fx in read_fixes().items():
            for li, j, ch in fx:
                self.fixed_at[f'{its[rec][fld]}:{li}:{j}'] = ch
        self._near: dict[tuple[str, bytes], list[tuple[int, str]]] = {}

    def nearest(self, kind: str, g) -> list[tuple[int, str]]:
        """切り出した字形と、フォントの全字形との食い違い（少ない順）"""
        k = (kind, g.key)
        if k not in self._near:
            prim = self.fonts[kind].primary
            seen: dict[bytes, str] = {}
            for ch, (bits, _, _) in prim.items():
                seen.setdefault(bytes([*bits.shape]) + np.packbits(bits).tobytes(), ch)
            self._near[k] = sorted((align_dist(g.bits, prim[ch][0]), ch) for ch in seen.values())
        return self._near[k]

    def judge(self, kind: str, g, ch: str, where: str) -> tuple[str, str]:
        """一致しない字: ('variant', '')・('confirmed', '')・('bad', 説明)"""
        font = self.fonts[kind]
        if self.fixed_at.get(where) == ch or (g.key in font.confirmed and font.shapes.get(g.key) == ch):
            return 'confirmed', ''
        near = self.nearest(kind, g)
        bits = self.fonts[kind].primary[ch][0]
        own = align_dist(g.bits, bits)
        limit = max(VARIANT_MAX_MIN, int(g.bits.sum()) // 8)
        rivals = [(d, c) for d, c in near if c != ch and not np.array_equal(self.fonts[kind].primary[c][0], bits)]
        if own <= limit and (not rivals or own < rivals[0][0]):
            return 'variant', ''
        cand = ' '.join(f'{c}:{d}' for d, c in near[:3])
        return 'bad', f'食い違い {own} 点（近い字 {cand}）'

    def check_field(self, src: str, text: str, is_profile: bool) -> tuple[int, tuple[int, int], list[str]]:
        """(違う点の数, (異体として通した字の数, 目で確かめた異体の字の数), 一致しないものの説明)"""
        lines = self.lines.get(src, [])
        if not lines:
            return 0, (0, 0), ([f'{src}: 絵に字が無いのに文字列がある'] if text else [])
        rows = text.replace(' ', '　').split('\n') if is_profile or lines[0].kind == 'desc' else [text]
        if len(rows) > len(lines):
            return 0, (0, 0), [f'{src}: 行の数が多い（{len(rows)} > {len(lines)}）']
        orig = ink_of(X, lines[0])
        canvas = np.zeros_like(orig)
        variants, confirmed, bad = 0, 0, []
        for ln in lines:
            row = list(rows[ln.index]) if ln.index < len(rows) else []
            font = self.fonts[ln.kind]
            if ln.kind == 'desc' and ln.grid:
                pairs = [(j, row[j] if j < len(row) else '　', ln.cells[j] if j < len(ln.cells) else None)
                         for j in range(max(len(row), len(ln.cells)))]
            else:
                chars = [c for c in row if c != '　']
                cells = [g for g in ln.cells if g is not None]
                pairs = [(j, chars[j] if j < len(chars) else '　', cells[j] if j < len(cells) else None)
                         for j in range(max(len(chars), len(cells)))]
            for j, ch, g in pairs:
                where = f'{src}:{ln.index}:{j}'
                if ch == '　':
                    if g is not None:
                        bad.append(f'{where}\t字が足りない（絵には字がある）')
                    continue
                if ch not in font.primary:
                    bad.append(f'{where}\t{ch}\tフォントに無い字')
                    continue
                bits, cx, cy = font.primary[ch]
                if ln.kind == 'desc' and ln.grid:
                    x = self.m['pen_x0'] + self.m['advance'] * j - self.m['cell_origin_x'] + cx
                    y = self.m['line_tops'][ln.index] - self.m['cell_origin_y'] + cy
                elif ln.kind == 'desc':
                    x, y = (g.x, g.y) if g is not None else (0, ln.top)
                else:
                    x, y = (g.x if g is not None else 0), NAME_TOP + cy
                paint(canvas, bits, x, y)
                if g is None:
                    bad.append(f'{where}\t{ch}\t余分な字（絵には字が無い）')
                elif not (np.array_equal(g.bits, bits) and (g.x, g.y) == (x, y)):
                    verdict, why = self.judge(ln.kind, g, ch, where)
                    if verdict == 'variant':
                        variants += 1
                    elif verdict == 'confirmed':
                        confirmed += 1
                    else:
                        bad.append(f'{where}\t{ch}\t{why}')
        diff = int((canvas != orig).sum())
        if lines[0].kind == 'desc':
            diff += int((make_shadow(canvas, self.m['shadow']['offset']) != shadow_of(X, src)).sum())
        return diff, (variants, confirmed), bad


def main() -> None:
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(X, 'tables', 'record_text.json')
    texts = json.load(open(path, encoding='utf-8'))['items']
    ck = Checker()
    exact = n_var_items = n_var = n_conf = 0
    report = []
    its = items()
    for it in its:
        t = texts.get(str(it['id']), {'name': '', 'desc': ''})
        name_kind = ck.lines.get(it['name'], [None])[0]
        is_profile = name_kind is not None and name_kind.kind == 'profile'
        total_diff, bad = 0, []
        for field in ('name', 'desc'):
            d, (v, c), b = ck.check_field(it[field], t[field], is_profile and field == 'name')
            total_diff += d
            n_var += v
            n_conf += c
            bad += [f'{it["id"]}\t{field}\t{x}' for x in b]
        if bad:
            report += bad
        elif total_diff == 0:
            exact += 1
        else:
            n_var_items += 1
    head = [f'項目 {len(its)}: 描き直して点まで同じ {exact}、異体の字を除けば同じ {n_var_items}'
            f'（異体の字: 自動で通した {n_var}・目で確かめた {n_conf}）、一致しない字 {len(report)}',
            '# 項目\t欄\t画像:行:並びの番号\t読んだ字\t理由']
    out = os.path.join(X, 'font', 'small', 'record_check.txt')
    with open(out, 'w', encoding='utf-8') as f:
        f.write('\n'.join(head + report) + '\n')
    print('\n'.join(head + report[:40]))
    print(f'→ {out}')
    sys.exit(1 if report else 0)


if __name__ == '__main__':
    main()
