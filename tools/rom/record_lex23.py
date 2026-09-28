"""台本の文を手がかりに、蘇る逆転に無い字形（2・3 の法廷記録の字）の票を足す。record_text23.py から使う。

字形ごとに、出てくる場所の前後の分かっている字（蘇る逆転の字形で引けた字）を並べた形（例「王都?の」）を
台本（日本語）から探し、? に当たる字を数える。前後は 4 字までから始め、見つからなければ短くする（合わせて 2 字まで）。
見つかった字のうち多いものが 8 割以上なら、前後の字の数に応じた票（CONTEXT_WEIGHT）を足す。
同じ行のほかの分からない字は任意の 1 字として扱う。small_font_lex.py（行全体を比べる）よりも、
分からない字が多い行でも使える。
"""
import collections
import glob
import os
import re

from small_font_ocr import norm

#: 前後の字の数 → 足す票の数（文字認識は 1 か所につき 4 票）
CONTEXT_WEIGHT = {2: 1, 3: 2, 4: 3, 5: 4}
MAX_SIDE = 4
AGREE = 0.8


def load_text(root: str) -> str:
    """日本語の台本（偶数番）の文をつないだもの（行の区切りは改行、空白は除く）"""
    out = []
    for p in sorted(glob.glob(os.path.join(root, 'script', '[0-9][0-9][0-9].txt'))):
        if int(os.path.basename(p)[:3]) % 2:
            continue
        for line in open(p, encoding='utf-8'):
            if line.startswith('== '):
                continue
            text = re.sub(r'\[[^\]]*\]', '', line.rstrip('\n'))
            out.append(''.join(norm(c) for c in text if not c.isspace()))
    return '\n'.join(out)


def pattern(chars: list[str | None], k: int, left: int, right: int) -> tuple[str, int] | None:
    """k 番目を ? にした前後 left・right 字の正規表現と、前後の分かっている字の数"""
    a, b = k - left, k + right
    if a < 0 or b >= len(chars):
        return None
    parts, known = [], 0
    for j in range(a, b + 1):
        if j == k:
            parts.append('([^\\n])')
        elif chars[j] is None:
            parts.append('[^\\n]')
        else:
            parts.append(re.escape(chars[j]))
            known += 1
    return ''.join(parts), known


def lex_votes(seqs: list[list[int]], known: dict[int, str], text: str) -> dict[int, collections.Counter]:
    """seqs = 行ごとの字形の番号（空きマスを除く）、known = 分かっている字形 → 文字"""
    votes: dict[int, collections.Counter] = collections.defaultdict(collections.Counter)
    cache: dict[str, collections.Counter] = {}
    for ids in seqs:
        chars = [known.get(i) for i in ids]
        for k, i in enumerate(ids):
            if i in known:
                continue
            for total in range(2 * MAX_SIDE, 1, -1):
                found = None
                for left in range(min(total, MAX_SIDE), -1, -1):
                    right = total - left
                    if right > MAX_SIDE:
                        continue
                    p = pattern(chars, k, left, right)
                    if p is None or p[1] < 2:
                        continue
                    if p[0] not in cache:
                        cache[p[0]] = collections.Counter(m.group(1) for m in re.finditer('(?=' + p[0] + ')', text))
                    c = cache[p[0]]
                    if c:
                        found = (c, p[1])
                        break
                if found:
                    c, n = found
                    best, cnt = c.most_common(1)[0]
                    if cnt / sum(c.values()) >= AGREE:
                        votes[i][best] += CONTEXT_WEIGHT[min(n, 5)]
                    break
    return votes


def bracket_votes(seqs: list[list[int]], known: dict[int, str], text: str, weight: int = 4) -> dict[int, collections.Counter]:
    """名前の行を、台本の《○○》（法廷記録の名前の呼び方）のうち字の数が同じで、分かっている字がすべて同じ位置にあるものと
    突き合わせる。当てはまるものがただ 1 通りなら、分からない字にその字の票（weight）を足す"""
    cands: dict[int, set[str]] = collections.defaultdict(set)
    for w in re.findall('《([^》\\n]{2,16})》', text):
        cands[len(w)].add(w)
    votes: dict[int, collections.Counter] = collections.defaultdict(collections.Counter)
    for ids in seqs:
        if all(i in known for i in ids):
            continue
        hit = {w for w in cands.get(len(ids), ()) if all(i not in known or known[i] == c for i, c in zip(ids, w))}
        if len(hit) == 1:
            w = hit.pop()
            for i, c in zip(ids, w):
                if i not in known:
                    votes[i][c] += weight
    return votes
