"""切り出した字形の並び（small_font_seg.py の Line）を画像にして macOS の文字認識で読み、字形ごとに文字を多数決で決める。
small_font.py から使う。文字認識は tools/rom/small_font_ocr.swift（ocr.swift に x 座標を足したもの）。
"""
import collections
import os
import subprocess
import tempfile
import unicodedata

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))

#: 1 枚の画像に並べる行の数、上下左右の余白（拡大前）
LINES_PER_IMAGE = 30
PAD = 8
#: 読み方の組み合わせ（拡大率, 字の間に足す点の数, 行の高さ）。組み合わせごとに 1 票ずつ入る
VARIANTS = ((4, 0, 24), (3, 2, 22), (5, 1, 26), (6, 0, 24))
#: 決まったとみなす割合・票の数
CONFIDENT = 0.6
MIN_VOTES = 2


def norm(ch: str) -> str:
    """比べるときの形にそろえる（全角・半角の違いなど）"""
    wide = unicodedata.normalize('NFKC', ch)
    ch = wide if len(wide) == 1 else ch
    return {'…': '‥', '.': '．', ',': '，', ':': '：', ';': '；', '(': '（', ')': '）', '~': '～', '〜': '～',
            '-': 'ー', '−': 'ー', '―': 'ー', '—': 'ー', '!': '！', '?': '？', '/': '／', '·': '・', '•': '・',
            '"': '”', "'": '’', '[': '［', ']': '］', '<': '＜', '>': '＞', '%': '％', '&': '＆', '+': '＋',
            '=': '＝', '#': '＃', '$': '＄', '*': '＊'}.get(ch, ch)


def positions(line) -> list[tuple[int, object]]:
    """行の中の字の並び (並びの番号, Glyph)。空きマスは番号だけ進む"""
    return [(j, g) for j, g in enumerate(line.cells) if g is not None]


def ocr(images: list[str], work: str) -> dict[str, list[tuple[float, float, str]]]:
    """画像ごとに、(y 座標, x 座標, 読んだ文字列) の一覧"""
    exe = os.path.join(work, 'ocr')
    subprocess.run(['swiftc', '-O', os.path.join(HERE, 'small_font_ocr.swift'), '-o', exe], check=True)
    out = subprocess.run([exe, *images], check=True, capture_output=True, text=True).stdout
    result: dict[str, list[tuple[float, float, str]]] = {}
    cur: list = []
    for line in out.splitlines():
        if line.startswith('# '):
            cur = result.setdefault(line[2:], [])
        elif line.count('\t') >= 2:
            y, x, text = line.split('\t', 2)
            cur.append((float(y), float(x), text))
    return result


def render(lines: list, path: str, scale: int, extra: int, line_h: int) -> int:
    width = max((g.x + g.bits.shape[1] + extra * j for ln in lines for j, g in positions(ln)), default=0)
    w, h = width + 2 * PAD, len(lines) * line_h + 2 * PAD
    img = np.full((h, w), 255, np.uint8)
    for li, ln in enumerate(lines):
        for j, g in positions(ln):
            bh, bw = g.bits.shape
            x, y = PAD + g.x + extra * j, PAD + li * line_h + (g.y - ln.top)
            img[y:y + bh, x:x + bw][g.bits] = 0
    img = img.repeat(scale, 0).repeat(scale, 1)
    Image.fromarray(img).save(path)
    return h * scale


def read_all(lines: list, work: str | None = None) -> list[list[str]]:
    """行ごとに、読み方の組み合わせで読んだ文字列の一覧"""
    texts: list[list[str]] = [[] for _ in lines]
    with tempfile.TemporaryDirectory() as tmp:
        work = work or tmp
        jobs = []
        for vi, (scale, extra, line_h) in enumerate(VARIANTS):
            for k in range(0, len(lines), LINES_PER_IMAGE):
                path = os.path.join(work, f'v{vi}_{k:05}.png')
                idx = list(range(k, min(k + LINES_PER_IMAGE, len(lines))))
                real_h = render([lines[i] for i in idx], path, scale, extra, line_h)
                jobs.append((path, idx, scale, line_h, real_h))
        print(f'画像 {len(jobs)} 枚を文字認識にかけます')
        results = ocr([j[0] for j in jobs], work)
        for path, idx, scale, line_h, real_h in jobs:
            got: dict[int, list[tuple[float, str]]] = collections.defaultdict(list)
            for y, x, text in results.get(path, []):
                li = round((y * real_h / scale - PAD - 6) / line_h)
                if 0 <= li < len(idx):
                    got[li].append((x, text))
            for li, parts in got.items():
                texts[idx[li]].append(''.join(t for _, t in sorted(parts)))
    return texts


def align(ids: list[int], text: str, known: dict[int, str]) -> list[tuple[int, str]]:
    """字形の番号の並びと読んだ文字列を突き合わせる（分かっている字形を目印にする）。(字形の番号, 文字) の組"""
    text = ''.join(norm(c) for c in text if not c.isspace())
    n, m = len(ids), len(text)
    kn = [known.get(i) for i in ids]
    score = np.zeros((n + 1, m + 1))
    back = np.zeros((n + 1, m + 1), np.int8)
    score[1:, 0] = -np.arange(1, n + 1)
    back[1:, 0] = 1
    score[0, 1:] = -np.arange(1, m + 1)
    back[0, 1:] = 2
    for a in range(1, n + 1):
        for b in range(1, m + 1):
            k = kn[a - 1]
            pair = 1.0 if k is None else (2.0 if k == text[b - 1] else -0.5)
            opts = (score[a - 1, b - 1] + pair, score[a - 1, b] - 1, score[a, b - 1] - 1)
            back[a, b] = int(np.argmax(opts))
            score[a, b] = max(opts)
    pairs, a, b = [], n, m
    while a > 0 and b > 0:
        step = back[a, b]
        if step == 0:
            pairs.append((ids[a - 1], text[b - 1]))
            a, b = a - 1, b - 1
        elif step == 1:
            a -= 1
        else:
            b -= 1
    return pairs


def vote(seqs: list[list[int]], texts: list[list[str]], rounds: int = 4) -> dict[int, collections.Counter]:
    """読んだ文字列を突き合わせて、字形ごとの票を数える。
    1 回目は字の数と文字数が同じ行だけを使い、2 回目からは票の多い字形を目印にしてずれを直す"""
    known: dict[int, str] = {}
    votes: dict[int, collections.Counter] = {}
    for r in range(rounds):
        votes = collections.defaultdict(collections.Counter)
        for ids, ts in zip(seqs, texts):
            for t in ts:
                t2 = ''.join(c for c in t if not c.isspace())
                if r == 0 and len(t2) != len(ids):
                    continue
                for i, ch in align(ids, t2, known):
                    votes[i][ch] += 1
        known = {}
        for i, c in votes.items():
            (best, n1), total = c.most_common(1)[0], sum(c.values())
            if n1 >= MIN_VOTES and n1 / total >= CONFIDENT:
                known[i] = best
    return votes
