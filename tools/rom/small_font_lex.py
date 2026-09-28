"""台本（日本語）の文を手がかりに、文字認識の読み違いを直す票を足す。small_font.py から使う。

名前（証拠品・人物）や説明文の言い回しは台詞にも出てくることが多い。今の対応で読んだ行と、台本の同じ長さの部分を
1 字ずつ比べ、ほとんど一致する部分がただ 1 通りに決まれば、違う字にその部分の字の票を足す。
"""
import collections
import glob
import os
import re

import numpy as np

from small_font_ocr import norm

#: 比べる行の最短の長さ、許す食い違いの数（長さに対して）、足す票の数
MIN_LEN = 4
WEIGHT = 2
#: これ以上の票（数・割合）がある字形は直さない
STRONG_VOTES, STRONG_RATIO = 6, 0.8


def load_corpus(root: str) -> np.ndarray:
    """日本語の台本（偶数番）の文を 1 本の配列に（行の区切りは 0）"""
    codes: list[int] = []
    for p in sorted(glob.glob(os.path.join(root, 'script', '[0-9][0-9][0-9].txt'))):
        if int(os.path.basename(p)[:3]) % 2:
            continue
        for line in open(p, encoding='utf-8'):
            if line.startswith('== '):
                continue
            text = re.sub(r'\[[^\]]*\]', '', line.rstrip('\n'))
            codes += [ord(norm(c)) for c in text if not c.isspace()]
            codes.append(0)
    return np.array(codes, np.int32)


def strong(d: dict) -> bool:
    return d['votes'] >= STRONG_VOTES and d['ratio'] >= STRONG_RATIO


def allowed_miss(n: int) -> int:
    return 1 if n < 6 else (2 if n < 10 else 3)


def suggest(seq: list[int], chars: list[str], corpus: np.ndarray) -> list[tuple[int, str, str]]:
    """1 行ぶん。(字形の番号, 今の文字, 台本の文字) の一覧（直すところが無ければ空）"""
    n = len(seq)
    if n < MIN_LEN or n > len(corpus):
        return []
    want = [ord(c) if len(c) == 1 else -1 for c in chars]
    windows = np.lib.stride_tricks.sliding_window_view(corpus, n)
    hits = (windows == np.array(want, np.int32)).sum(1)
    best = int(hits.max())
    if best == n or best < n - allowed_miss(n):
        return []
    cand = {tuple(windows[k]) for k in np.nonzero(hits == best)[0]}
    cand = {c for c in cand if 0 not in c}
    if len(cand) != 1:
        return []
    got = cand.pop()
    return [(seq[k], chars[k], chr(got[k])) for k in range(n) if got[k] != want[k]]


def is_word(ch: str) -> bool:
    """かな・漢字・英数字（句読点・記号は文の切れ目で食い違いやすいので直さない）"""
    return len(ch) == 1 and (ch.isalnum() or ch in 'ー々ヶ')


def corpus_votes(seqs: list[list[int]], dec: list[dict], corpus: np.ndarray, weight: int = WEIGHT) -> tuple[dict[int, collections.Counter], list[str]]:
    """全部の行について台本と比べ、足す票と、その記録（報告用）を返す。
    直すのは、文字認識の票が弱い（STRONG に届かない）字形の、かな・漢字・英数字どうしの食い違いだけ。
    weight = 0 なら票は足さず、記録だけ（説明文は台詞と言い回しが違うことが多く、誤って直しやすいため）"""
    extra: dict[int, collections.Counter] = collections.defaultdict(collections.Counter)
    log = []
    for seq in seqs:
        chars = [dec[i]['char'] for i in seq]
        fix = [(i, old, new) for i, old, new in suggest(seq, chars, corpus)
               if is_word(old) and is_word(new) and not strong(dec[i])]
        for i, old, new in fix:
            extra[i][new] += weight
        if fix:
            log.append(f"{''.join(chars)} → " + ' '.join(f'{old}→{new}' for _, old, new in fix))
    return extra, log
