"""DS 版のフォントにない漢字を、DS 版の字形の部品（へん・つくりなど）を組み合わせて作る。

    python3 tools/rom/compose.py <文字 または ファイル>... [--font assets/extracted/font]
    例: python3 tools/rom/compose.py apps/player/cases/*.yaml     # シナリオで使っていて、ないものを全部

作り方（上から順に試す）:
  1. その字を部品に含む DS 版の字から切り出し、マスの幅に広げる（例: 鳥 ← 鳴 の右）
  2. 同じ部品を同じ位置に持つ DS 版の字から、それぞれの部品を切り出して並べる（例: 鐘 ← 鉄 の左 + ?童 の右）
  3. 2 で部品が見つからなければ、その部品だけの字（なければ、さらに分解して作ったもの）を縮めて使う

部品の組み立ては tools/rom/data/ids.txt（cjkvi-ids、CHISE 由来、GPLv2）による。
出力: tools/rom/font_extra.draft.txt（「# 文字」と 16 行の点）。目で見て直してから font_extra.txt に移す。
"""
import glob
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_font import read_tsv  # noqa: E402
from charset import KANJI_START, LAYOUT  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
N = 16
#: DS 版にない部品を、形の似た字で代用する
SUBSTITUTES = {'菐': '業'}
Glyph = list[list[bool]]
LR, TB = '⿰', '⿱'


def load_font(src: str) -> dict[str, Glyph]:
    glyphs = [b.split('\n')[1:17] for b in open(os.path.join(src, 'glyphs.txt')).read().split('# ')[1:]]
    mapping = read_tsv(os.path.join(src, 'mapping.tsv'))
    mapping.update(read_tsv(os.path.join(HERE, 'font_fixes.tsv')))
    end = min((i for i, c in mapping.items() if i >= KANJI_START and c == ''), default=len(glyphs))
    font: dict[str, Glyph] = {}
    for i in sorted(mapping):
        ch = mapping[i]
        if len(ch) == 1 and i < end and i >= len(LAYOUT):
            font.setdefault(ch, [[c == '@' for c in row] for row in glyphs[i]])
    return font


def load_parts() -> dict[str, Glyph]:
    """手で描いた部品（font_parts.txt）"""
    parts: dict[str, Glyph] = {}
    lines = open(os.path.join(HERE, 'font_parts.txt'), encoding='utf-8').read().split('\n')
    for i, line in enumerate(lines):
        if line.startswith('# ') and len(line.split()[1]) == 1:
            parts[line.split()[1]] = [[c == '@' for c in row.ljust(N, '.')[:N]] for row in lines[i + 1:i + 1 + N]]
    return parts


def load_ids() -> dict[str, str]:
    ids = {}
    for line in open(os.path.join(HERE, 'data/ids.txt'), encoding='utf-8'):
        p = line.rstrip('\n').split('\t')
        if len(p) >= 3 and not p[0].startswith('#'):
            ids[p[1]] = p[2].split('[')[0]
    return ids


def binary(ids: str) -> tuple[str, str, str] | None:
    """「⿰AB」「⿱AB」の形なら (記号, A, B)。部品が 1 文字でないものは扱わない"""
    chars = list(ids)
    if len(chars) == 3 and chars[0] in (LR, TB):
        return chars[0], chars[1], chars[2]
    return None


def bbox(g: Glyph) -> tuple[int, int, int, int]:
    ys = [y for y in range(N) if any(g[y])]
    xs = [x for x in range(N) if any(g[y][x] for y in range(N))]
    return (min(xs), min(ys), max(xs) + 1, max(ys) + 1) if xs else (0, 0, 0, 0)


def split_at(g: Glyph, op: str) -> int:
    """部品の境目（左右なら列、上下なら行）。字の範囲の中ほどで、点がいちばん少ない所"""
    x0, y0, x1, y1 = bbox(g)
    lo, hi = (x0, x1) if op == LR else (y0, y1)
    count = (lambda k: sum(g[y][k] for y in range(N))) if op == LR else (lambda k: sum(g[k]))
    span = hi - lo
    candidates = range(lo + span * 3 // 10, lo + span * 7 // 10 + 1)
    return min(candidates, key=lambda k: (count(k), abs(k - (lo + hi) / 2)))


def cut(g: Glyph, op: str, first: bool) -> Glyph:
    """境目で分けた片方だけを残す"""
    s = split_at(g, op)
    return [[g[y][x] and ((x < s if first else x >= s) if op == LR else (y < s if first else y >= s)) for x in range(N)]
            for y in range(N)]


def resize_axis(rows: list[list[bool]], n: int) -> list[list[bool]]:
    """各行を長さ n に直す。縮めるときは重なる点をまとめ（細い線を消さない）、
    広げるときは点の間を空けて置き、左右どちらも点の所だけつなぐ（縦線を太らせない）"""
    out = []
    for row in rows:
        m = len(row)
        new = [False] * n
        if n <= m:
            for i, v in enumerate(row):
                if v:
                    new[i * n // m] = True
        else:
            pos = [round(i * (n - 1) / (m - 1)) if m > 1 else 0 for i in range(m)]
            for i, v in enumerate(row):
                if v:
                    new[pos[i]] = True
                if i + 1 < m and v and row[i + 1]:
                    for k in range(pos[i], pos[i + 1] + 1):
                        new[k] = True
        out.append(new)
    return out


def fit(g: Glyph, box: tuple[int, int, int, int]) -> Glyph:
    """字の範囲を box（x0, y0, x1, y1）の大きさに直して置く"""
    x0, y0, x1, y1 = bbox(g)
    bx0, by0, bx1, by1 = box
    out = [[False] * N for _ in range(N)]
    if x1 <= x0:
        return out
    crop = [row[x0:x1] for row in g[y0:y1]]
    wide = resize_axis(crop, bx1 - bx0)
    cols = [list(c) for c in zip(*wide)]
    tall = [list(r) for r in zip(*resize_axis(cols, by1 - by0))]
    for y, row in enumerate(tall):
        for x, v in enumerate(row):
            out[by0 + y][bx0 + x] = v
    return out


def union(a: Glyph, b: Glyph) -> Glyph:
    return [[a[y][x] or b[y][x] for x in range(N)] for y in range(N)]


class Composer:
    def __init__(self, font: dict[str, Glyph], ids: dict[str, str], parts: dict[str, Glyph] | None = None):
        self.font, self.ids, self.parts = font, ids, parts or {}
        self.parsed = {c: binary(s) for c, s in ids.items() if c in font}
        # 標準の字の範囲（DS 版の漢字の平均的な範囲）
        self.full = (1, 3, 14, 16)

    def donors(self, op: str, part: str, first: bool) -> list[str]:
        """part を op の first 側（左・上）または反対側に持つ DS 版の字"""
        return [c for c, p in self.parsed.items() if p and p[0] == op and p[1 if first else 2] == part]

    def glyph(self, ch: str, depth: int = 0) -> tuple[Glyph, str] | None:
        """(字形, 作り方の説明)"""
        if ch in self.font:
            return self.font[ch], 'DS'
        if ch in self.parts:
            return self.parts[ch], '手描きの部品'
        if ch in SUBSTITUTES and SUBSTITUTES[ch] in self.font:
            return self.font[SUBSTITUTES[ch]], f'{SUBSTITUTES[ch]} で代用'
        # 1. その字を部品に含む字から切り出して広げる
        for c, p in self.parsed.items():
            if p and ch in (p[1], p[2]):
                part = cut(self.font[c], p[0], p[1] == ch)
                return fit(part, self.full), f'{c} の{"左" if p[0] == LR and p[1] == ch else "右" if p[0] == LR else "上" if p[1] == ch else "下"}を広げた'
        parsed = binary(self.ids.get(ch, ''))
        if not parsed or depth > 2:
            return None
        op, a, b = parsed
        parts, notes = [], []
        for part, first in ((a, True), (b, False)):
            donors = self.donors(op, part, first)
            if donors:
                parts.append(cut(self.font[donors[0]], op, first))
                notes.append(f'{donors[0]}の{("左" if first else "右") if op == LR else ("上" if first else "下")}')
                continue
            # 2 で見つからなければ、部品だけの字を縮めて置く
            sub = self.glyph(part, depth + 1)
            if not sub:
                return None
            parts.append(None)
            parts.append(sub[0])
            notes.append(f'{part}（{sub[1]}）を縮めた')
        return self.assemble(op, parts), ' + '.join(notes)

    def assemble(self, op: str, parts: list) -> Glyph:
        """切り出した部品（そのままの位置）と、縮めて置く部品（None の次）を組み合わせる"""
        placed: list[Glyph] = []
        pending = False
        for p in parts:
            if p is None:
                pending = True
                continue
            placed.append(('fit', p) if pending else ('keep', p))
            pending = False
        (ka, a), (kb, b) = placed
        x0, y0, x1, y1 = self.full
        if op == LR:
            # 左の部品の右端、または右の部品の左端を境目にする
            mid = bbox(a)[2] + 1 if ka == 'keep' else (bbox(b)[0] - 1 if kb == 'keep' else (x0 + x1) // 2 - 1)
            if ka == 'fit':
                a = fit(a, (x0, y0, mid - 1, y1))
            if kb == 'fit':
                b = fit(b, (mid, y0, x1, y1))
        else:
            mid = bbox(a)[3] + 1 if ka == 'keep' else (bbox(b)[1] - 1 if kb == 'keep' else (y0 + y1) // 2)
            if ka == 'fit':
                a = fit(a, (x0, y0, x1, mid - 1))
            if kb == 'fit':
                b = fit(b, (x0, mid, x1, y1))
        return union(a, b)


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    src = sys.argv[sys.argv.index('--font') + 1] if '--font' in sys.argv else 'assets/extracted/font'
    if '--font' in sys.argv:
        args.remove(src)
    font = load_font(src)
    text = ''
    for a in args:
        paths = glob.glob(a)
        text += ''.join(open(p, encoding='utf-8').read() for p in paths) if paths else a
    targets = sorted({ch for ch in text if 0x4E00 <= ord(ch) <= 0x9FFF and ch not in font}, key=ord)
    composer = Composer(font, load_ids(), load_parts())
    out, failed = [], []
    for ch in targets:
        r = composer.glyph(ch)
        if not r:
            failed.append(ch)
            continue
        g, note = r
        out.append(f'# {ch}\t{note}\n' + '\n'.join(''.join('@' if v else '.' for v in row) for row in g))
    path = os.path.join(HERE, 'font_extra.draft.txt')
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(out) + '\n')
    print(f'{len(out)} 字を作りました → {path}' + (f'（作れなかった字: {"".join(failed)}）' if failed else ''))


if __name__ == '__main__':
    main()
