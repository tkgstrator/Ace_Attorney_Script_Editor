"""台詞を DS 版の字形で画像にして macOS の文字認識で読み、漢字の番号が何の字かを多数決で決める。

    python3 tools/rom/ocr_font.py <rom.nds> [出力フォルダ] [--base <文字が分かっているフォントのフォルダ>]

前提: 先に dsfont.py で glyphs.txt を作っておく。macOS（Vision）と swiftc が必要。
--base を付けると（例: 他の作品の ROM）、base のフォントと点の並びが同じ字形はその文字とし、
残りだけを文字認識で決める。付けなければ、かな・記号は charset.py の並び順で決める。

出力:
  mapping.tsv   番号・文字・票数・読めた回数・割合・ほかの候補（かな・記号は並び順で決めたもの）
  review.txt    票が割れた番号（要確認）
"""
import collections
import os
import subprocess
import sys
import tempfile
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from charset import KANJI_START, LAYOUT  # noqa: E402
from script import read_script, text_runs  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
#: 1 つの漢字につき、読ませる台詞の数（1 回目と、票が割れた漢字の 2 回目）
LINES_PER_KANJI = 6
LINES_RETRY = 20
#: 決めたとみなす割合
CONFIDENT = 0.6
#: 1 枚の画像に並べる台詞の数と、1 行の最大文字数
LINES_PER_IMAGE = 40
MAX_CHARS = 26
PITCH, LINE_H, PAD, SCALE = 14, 24, 16, 4


def read_glyphs(path: str) -> list[list[str]]:
    return [b.split('\n')[1:17] for b in open(path).read().split('# ')[1:]]


def pick_lines(runs: list[list[int]], unknown: set[int], per_kanji: int = LINES_PER_KANJI,
               skip: set[tuple[int, ...]] | None = None) -> list[list[int]]:
    """分からない字ごとに、手がかり（分かっている字）の多い台詞を選ぶ（skip の台詞は除く）"""
    unique = {tuple(r) for r in runs if 3 <= len(r) <= MAX_CHARS} - (skip or set())
    by_kanji: dict[int, list[tuple[int, ...]]] = collections.defaultdict(list)
    for r in unique:
        for i in set(r):
            if i in unknown:
                by_kanji[i].append(r)
    chosen: set[tuple[int, ...]] = set()
    for lines in by_kanji.values():
        # 漢字の割合が低い（前後の手がかりが多い）順
        lines.sort(key=lambda r: (sum(i in unknown for i in r) / len(r), len(r)))
        chosen.update(lines[:per_kanji])
    return [list(r) for r in sorted(chosen)]


def render(lines: list[list[int]], glyphs: list[list[str]], path: str) -> None:
    w = MAX_CHARS * PITCH + 2 * PAD
    h = len(lines) * LINE_H + 2 * PAD
    img = bytearray([255]) * (w * h)
    for li, run in enumerate(lines):
        for k, i in enumerate(run):
            for y, row in enumerate(glyphs[i]):
                for x, c in enumerate(row):
                    if c == '@':
                        img[(PAD + li * LINE_H + y) * w + PAD + k * PITCH + x] = 0
    raw = path + '.gray'
    with open(raw, 'wb') as f:
        f.write(img)
    subprocess.run(['magick', '-size', f'{w}x{h}', '-depth', '8', f'gray:{raw}', '-filter', 'point',
                    '-resize', f'{SCALE * 100}%', path], check=True)
    os.remove(raw)


def ocr(images: list[str], work: str) -> dict[str, list[tuple[float, str]]]:
    """画像ごとに、(y 座標, 読んだ文字列) の一覧"""
    exe = os.path.join(work, 'ocr')
    subprocess.run(['swiftc', '-O', os.path.join(HERE, 'ocr.swift'), '-o', exe], check=True)
    out = subprocess.run([exe, *images], check=True, capture_output=True, text=True).stdout
    result: dict[str, list[tuple[float, str]]] = {}
    cur: list[tuple[float, str]] = []
    for line in out.splitlines():
        if line.startswith('# '):
            cur = result.setdefault(line[2:], [])
        elif '\t' in line:
            y, text = line.split('\t', 1)
            cur.append((float(y), text))
    return result


def norm(ch: str) -> str:
    """読み違えやすい記号をそろえて比べる"""
    ch = unicodedata.normalize('NFKC', ch)
    return {'‥': '・', '…': '・', '.': '・', '一': 'ー', '-': 'ー', '−': 'ー', ',': '、', '〕': ')', '〔': '('}.get(ch, ch)


def is_kanji(ch: str) -> bool:
    return 0x4E00 <= ord(ch) <= 0x9FFF or ch in '々〆ヶ'


def align(run: list[int], text: str, names: dict[int, str]) -> list[tuple[int, str]]:
    """番号の並びと読んだ文字列を突き合わせ、分からない番号に当たる文字を返す（分かっている字を目印にする）"""
    n, m = len(run), len(text)
    known = [norm(names[i]) if i in names else None for i in run]
    score = [[0.0] * (m + 1) for _ in range(n + 1)]
    back = [[0] * (m + 1) for _ in range(n + 1)]
    for a in range(1, n + 1):
        score[a][0], back[a][0] = -a, 1
    for b in range(1, m + 1):
        score[0][b], back[0][b] = -b, 2
    for a in range(1, n + 1):
        for b in range(1, m + 1):
            c = text[b - 1]
            if known[a - 1] is None:
                pair = 1.0 if is_kanji(c) else 0.2
            else:
                pair = 2.0 if known[a - 1] == norm(c) else -1.0
            options = [(score[a - 1][b - 1] + pair, 0), (score[a - 1][b] - 1, 1), (score[a][b - 1] - 1, 2)]
            score[a][b], back[a][b] = max(options)
    pairs, a, b = [], n, m
    while a > 0 or b > 0:
        step = back[a][b] if a > 0 and b > 0 else (1 if a > 0 else 2)
        if step == 0:
            if known[a - 1] is None:
                pairs.append((run[a - 1], text[b - 1]))
            a, b = a - 1, b - 1
        elif step == 1:
            a -= 1
        else:
            b -= 1
    return pairs


def read_lines(lines: list[list[int]], glyphs: list[list[str]], votes: dict[int, collections.Counter],
               names: dict[int, str]) -> None:
    """台詞を画像にして読み、漢字の番号ごとに読めた文字を数える"""
    with tempfile.TemporaryDirectory() as work:
        batches = [lines[k:k + LINES_PER_IMAGE] for k in range(0, len(lines), LINES_PER_IMAGE)]
        images = []
        for bi, batch in enumerate(batches):
            path = os.path.join(work, f'{bi:04}.png')
            render(batch, glyphs, path)
            images.append(path)
        print(f'画像 {len(images)} 枚を文字認識にかけます')
        results = ocr(images, work)
        for path, batch in zip(images, batches):
            real_h = len(batch) * LINE_H + 2 * PAD
            for y, text in results.get(path, []):
                # y（0〜1）から、どの行の台詞かを決める
                li = round((y * real_h - PAD - 8) / LINE_H)
                if 0 <= li < len(batch):
                    for idx, ch in align(batch[li], text, names):
                        votes[idx][ch] += 1


def glyph_key(g: list[str]) -> tuple[str, ...] | None:
    """位置によらない字形の比較用（点のある行・列だけに詰める）"""
    rows = [r for r in g if '@' in r]
    if not rows:
        return None
    x0 = min(r.find('@') for r in rows)
    return tuple(r[x0:].rstrip('.') for r in rows)


def known_from_base(glyphs: list[list[str]], base_dir: str) -> dict[int, str]:
    """base のフォントと点の並びが同じ字形に、base の文字を当てる"""
    from build_font import read_tsv
    base = read_glyphs(os.path.join(base_dir, 'glyphs.txt'))
    mapping = read_tsv(os.path.join(base_dir, 'mapping.tsv'))
    mapping.update(read_tsv(os.path.join(HERE, 'font_fixes.tsv')))
    by_shape: dict[tuple[str, ...], str] = {}
    for i, g in enumerate(base):
        ch = mapping.get(i, '')
        k = glyph_key(g)
        if len(ch) == 1 and k:
            by_shape.setdefault(k, ch)
    return {i: by_shape[k] for i, g in enumerate(glyphs) if (k := glyph_key(g)) in by_shape}


def main() -> None:
    args = [a for a in sys.argv[1:]]
    base_dir = None
    if '--base' in args:
        k = args.index('--base')
        base_dir = args[k + 1]
        del args[k:k + 2]
    if not args:
        sys.exit('使い方: python3 tools/rom/ocr_font.py <rom.nds> [出力フォルダ] [--base <フォルダ>]')
    out = args[1] if len(args) > 1 else 'assets/extracted/font'
    glyphs = read_glyphs(os.path.join(out, 'glyphs.txt'))
    names = known_from_base(glyphs, base_dir) if base_dir else dict(enumerate(LAYOUT))
    unknown = {i for i, g in enumerate(glyphs) if i not in names and any('@' in r for r in g)}
    if not base_dir:
        unknown = {i for i in unknown if i >= KANJI_START}
    runs = text_runs(read_script(open(args[0], 'rb').read()), glyph_count=len(glyphs))
    used = {i for r in runs for i in r}
    unknown &= used
    print(f'分かっている字 {len(names)}、台詞に出てくる分からない字 {len(unknown)}')
    lines = pick_lines(runs, unknown)
    print(f'台詞 {len(runs)} 行から、文字認識にかける {len(lines)} 行を選びました')

    votes: dict[int, collections.Counter] = collections.defaultdict(collections.Counter)
    read_lines(lines, glyphs, votes, names)
    weak = {i for i, c in votes.items() if c.most_common(1)[0][1] / sum(c.values()) < CONFIDENT or sum(c.values()) < 3}
    retry = pick_lines(runs, weak, per_kanji=LINES_RETRY, skip={tuple(r) for r in lines})
    if retry:
        print(f'票が割れた・少ない字 {len(weak)} 字のため、さらに {len(retry)} 行を読みます')
        read_lines(retry, glyphs, votes, names)

    rows, review = [], []
    for i in sorted(names):
        rows.append(f'{i}\t{names[i]}\t-\t-\t1.00\t')
    for idx in sorted(unknown):
        c = votes.get(idx)
        if not c:
            continue
        (best, n1), total = c.most_common(1)[0], sum(c.values())
        others = ' '.join(f'{k}:{v}' for k, v in c.most_common(4)[1:])
        rows.append(f'{idx}\t{best}\t{n1}\t{total}\t{n1 / total:.2f}\t{others}')
        if n1 / total < CONFIDENT or total < 2:
            review.append(f'{idx}\t{best}\t{n1}/{total}\t{others}')
    rows.sort(key=lambda r: int(r.split('\t')[0]))
    with open(os.path.join(out, 'mapping.tsv'), 'w') as f:
        f.write('# 番号\t文字\t票数\t読めた回数\t割合\tほかの候補\n' + '\n'.join(rows) + '\n')
    with open(os.path.join(out, 'review.txt'), 'w') as f:
        f.write('# 票が割れた・読めた回数が少ない番号（番号\t文字\t票\tほかの候補）\n' + '\n'.join(review) + '\n')
    decided = sum(1 for i in unknown if i in votes)
    print(f'{decided} 字の対応を決めました（要確認 {len(review)} 字）→ {out}/mapping.tsv, review.txt')


if __name__ == '__main__':
    main()
