"""法廷記録の絵（record/desc/ja・record/name/ja）の字を、小さいフォント（small_font.py の結果）で扱う共通の部品。
record_text.py（読む）・record_text_check.py（描き直して確かめる）から使う。

- 絵の切り分けは small_font.py と同じ（small_font_seg.py。名前は証拠品と人物ファイルに分ける）。
- 読むときは、切り出した字形を small/glyphs.json（small_font.py が書き出す全字形と文字の対応）から点の並びの完全一致で引く。
- 描き直すときは、フォントの PNG（ds-small-*.png）の字形だけを使う。
"""
import json
import os
import sys
from dataclasses import dataclass, field

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from small_font import load  # noqa: E402
from small_font_out import ATLAS  # noqa: E402
from small_font_seg import DESC_INK, DESC_SHADOW, DESC_TEXT_H, NAME_CELL, NAME_INK, NAME_TOP  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
X = os.path.join(ROOT, 'assets', 'extracted')
KINDS = ('desc', 'name', 'profile')
#: 読めなかった字（字形の一覧に無い）
UNKNOWN = '〓'


def unkey(key: bytes) -> np.ndarray:
    """字形の鍵（small_font_seg.Glyph.key）→ 点の並び"""
    h, w = key[0], key[1]
    return np.unpackbits(np.frombuffer(key[2:], np.uint8))[:h * w].reshape(h, w).astype(bool)


@dataclass
class Font:
    """1 種類（説明文・証拠品の名前・人物ファイルの名前）のフォント"""
    kind: str
    #: 字形の鍵 → 文字（切り出した全字形。点の並びの完全一致で引く）
    shapes: dict[bytes, str] = field(default_factory=dict)
    #: 目で見て文字を確かめた字形（small_font_fixes.tsv に載っているもの）
    confirmed: set[bytes] = field(default_factory=set)
    #: 文字 → (点の並び, マスの中の左端, 上端)。フォントの PNG に入っている字形
    primary: dict[str, tuple[np.ndarray, int, int]] = field(default_factory=dict)


def load_fonts(x_dir: str = X) -> dict[str, Font]:
    font_dir = os.path.join(x_dir, 'font')
    table = json.load(open(os.path.join(font_dir, 'small', 'glyphs.json'), encoding='utf-8'))
    fonts = {}
    for kind in KINDS:
        f = Font(kind)
        for g in table[kind]:
            if g['char']:
                f.shapes[bytes.fromhex(g['key'])] = g['char']
                if g.get('fixed'):
                    f.confirmed.add(bytes.fromhex(g['key']))
        name, size, _ = ATLAS[kind]
        meta = json.load(open(os.path.join(font_dir, name + '.json'), encoding='utf-8'))
        img = np.array(Image.open(os.path.join(font_dir, name + '.png'))) > 127
        cols = meta['columns']
        for k, ch in enumerate(meta['chars']):
            cell = img[(k // cols) * size:(k // cols + 1) * size, (k % cols) * size:(k % cols + 1) * size]
            ys, xs = np.nonzero(cell)
            if len(ys):
                f.primary[ch] = (cell[ys.min():ys.max() + 1, xs.min():xs.max() + 1], int(xs.min()), int(ys.min()))
        fonts[kind] = f
    return fonts


def metrics(x_dir: str = X) -> dict:
    return json.load(open(os.path.join(x_dir, 'font', 'ds-small-font.metrics.json'), encoding='utf-8'))


def record_lines(x_dir: str = X) -> dict[str, list]:
    """絵の相対パス → 切り分けた行の一覧（small_font_seg.Line。kind は desc / name / profile）"""
    out: dict[str, list] = {}
    for lines in load(x_dir).values():
        for ln in lines:
            out.setdefault(ln.src, []).append(ln)
    for v in out.values():
        v.sort(key=lambda ln: ln.index)
    return out


def items(x_dir: str = X) -> list[dict]:
    """evidence.json の項目（id と、名前・説明文の絵の相対パス）。表の欄が空き（tbl_record.blank_fields）で絵が無いものは ''"""
    ev = json.load(open(os.path.join(x_dir, 'tables', 'evidence.json'), encoding='utf-8'))
    out = []
    for it in ev['items']:
        img = it.get('image', {})
        name, desc = (img.get(k, {}).get('ja') or '' for k in ('name', 'desc'))
        if name or desc:
            out.append({'id': it['id'], 'name': name, 'desc': desc})
    return out


def decode_line(line, font: Font) -> list[str]:
    """1 行の字の並び（空きマスは '　'、一覧に無い字形は UNKNOWN）"""
    return ['　' if g is None else font.shapes.get(g.key, UNKNOWN) for g in line.cells]


def ink_of(x_dir: str, line) -> np.ndarray:
    """元の絵の字の点（説明文は枠の線を除いた y=2〜46、名前は字の帯）"""
    a = np.array(Image.open(os.path.join(x_dir, line.src)))
    if line.kind == 'desc':
        ink = np.zeros(a.shape, bool)
        ink[2:DESC_TEXT_H] = a[2:DESC_TEXT_H] == DESC_INK
        return ink
    ink = np.zeros(a.shape, bool)
    ink[NAME_TOP:NAME_TOP + NAME_CELL] = a[NAME_TOP:NAME_TOP + NAME_CELL] == NAME_INK
    return ink


def shadow_of(x_dir: str, src: str) -> np.ndarray:
    a = np.array(Image.open(os.path.join(x_dir, src)))
    s = np.zeros(a.shape, bool)
    s[2:DESC_TEXT_H] = a[2:DESC_TEXT_H] == DESC_SHADOW
    return s


def paint(canvas: np.ndarray, bits: np.ndarray, x: int, y: int) -> None:
    """canvas の (x, y) に点を重ねる（はみ出す分は捨てる）"""
    h, w = bits.shape
    H, W = canvas.shape
    x0, y0, x1, y1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
    if x0 < x1 and y0 < y1:
        canvas[y0:y1, x0:x1] |= bits[y0 - y:y1 - y, x0 - x:x1 - x]


def make_shadow(ink: np.ndarray, offset: tuple[int, int]) -> np.ndarray:
    dx, dy = offset
    s = np.zeros_like(ink)
    s[dy:, dx:] = ink[:ink.shape[0] - dy, :ink.shape[1] - dx]
    s[:2] = False
    s[DESC_TEXT_H:] = False
    return s & ~ink


def align_dist(a: np.ndarray, b: np.ndarray, reach: int = 1) -> int:
    """2 つの点の並びを左上をそろえて置き、上下左右に reach 点までずらしたときの、食い違う点の数の最小"""
    h = max(a.shape[0], b.shape[0]) + 2 * reach
    w = max(a.shape[1], b.shape[1]) + 2 * reach
    ca = np.zeros((h, w), bool)
    ca[reach:reach + a.shape[0], reach:reach + a.shape[1]] = a
    best = None
    for dy in range(2 * reach + 1):
        for dx in range(2 * reach + 1):
            cb = np.zeros((h, w), bool)
            cb[dy:dy + b.shape[0], dx:dx + b.shape[1]] = b
            d = int((ca ^ cb).sum())
            best = d if best is None else min(best, d)
    return best
