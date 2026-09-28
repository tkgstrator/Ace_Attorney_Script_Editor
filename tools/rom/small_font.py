# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "pillow"]
# ///
"""法廷記録の小さい字（証拠品・人物の名前と説明文）を、ゲームの画像から切り出してドットフォントにする。

    uv run tools/rom/small_font.py [assets/extracted] [--reocr]

ROM に小さい字のフォントは無く、この字は tbl_record.py が書き出した絵（record/desc/ja/NNN.png、record/name/ja/NNN.png）
の中にしか無い。そこで:
  1. 絵を 1 字ずつの字形に切り分ける（small_font_seg.py。影は字形に含めない）
  2. 点の並びがまったく同じ字形を 1 つにまとめる
  3. 行ごとに影を除いた字形を並べた画像を macOS の文字認識で読み、字形ごとに多数決で文字を決める（small_font_ocr.py）。
     名前は、台本とほとんど一致すれば台本の字にも票を足す（small_font_lex.py。説明文は報告に載せるだけ）
  4. tools/rom/small_font_fixes.tsv（目で見て直した・確かめた対応）で上書きする
  5. フォントの PNG と JSON、寸法、確認用の一覧を書き出す（small_font_out.py）
前提: macOS（Vision）と swiftc。文字認識の結果は font/small/ocr.json に取っておき、--reocr で読み直す。

出力（assets/extracted/font/）:
  ds-small-font.png / .json        説明文の字（12×12 のマス、ds-font と同じ形式 {size, columns, chars}、白 = 字）
  ds-small-name-font.png / .json          証拠品の名前の字（14×14 のマス）
  ds-small-profile-name-font.png / .json  人物ファイルの名前の字（14×14 のマス。証拠品とは字形が違う）
  ds-small-font.metrics.json       マスの原点・送り・行の送り・影・色
  small/review.png                 全字形と当てた文字の一覧（確認用）
  small/review.tsv                 確かさの低い対応（要確認）
  small/report.txt                 数・網羅率・第 1 話の正解との照合・足りない字
  small/glyphs.json                全字形（点の並び）と当てた文字（record_text.py が法廷記録の文字を引くのに使う）

※ 元のゲームの字形そのものなので、手元で使うだけにして配布しないこと。
"""
import collections
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from small_font_ocr import norm, read_all, vote  # noqa: E402
from small_font_lex import corpus_votes, load_corpus  # noqa: E402
from small_font_seg import read_desc, read_name  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
FIXES = os.path.join(HERE, 'small_font_fixes.tsv')
KINDS = ('desc', 'name', 'profile')


def has_age(line) -> bool:
    """名前の最後が閉じかっこ（細くて高さいっぱいの字形）＝「綾里 千尋（27）」のような年齢付き"""
    last = next((g for g in reversed(line.cells) if g is not None), None)
    return last is not None and last.bits.shape[1] <= 3 and last.bits.shape[0] >= 13


def split_names(root: str, lines: list) -> tuple[list, list]:
    """名前を証拠品と人物ファイルに分ける（字形が違う別のフォント）。
    年齢のかっこが付けば人物ファイル。付かなくても、法廷記録の表から使われず、字形がすべて年齢付きの名前と同じなら人物ファイル
    （114〜121 の年齢の無い人物名）"""
    ev = json.load(open(os.path.join(root, 'tables', 'evidence.json'), encoding='utf-8'))
    used = {it['image']['name']['ja'] for it in ev['items']}
    aged = [ln for ln in lines if has_age(ln)]
    shapes = {g.key for ln in aged for g in ln.cells if g is not None}
    profile, evidence = [], []
    for ln in lines:
        keys = [g.key for g in ln.cells if g is not None]
        if ln in aged or (ln.src not in used and keys and all(k in shapes for k in keys)):
            profile.append(ln)
        else:
            evidence.append(ln)
    return evidence, profile


def load(root: str) -> dict[str, list]:
    """種類 → 行の一覧。desc = 説明文、name = 証拠品の名前、profile = 人物ファイルの名前"""
    out = {}
    for kind, reader in (('desc', read_desc), ('name', read_name)):
        lines = []
        for p in sorted(glob.glob(os.path.join(root, 'record', kind, 'ja', '*.png'))):
            lines += reader(root, os.path.relpath(p, root))
        out[kind] = lines
    out['name'], out['profile'] = split_names(root, out['name'])
    for ln in out['profile']:
        ln.kind = 'profile'
    return out


def cluster(lines: list) -> tuple[list[list[int | None]], list, dict[int, list[tuple[int, int]]]]:
    """点の並びが同じ字形に番号を振る（最初に出てきた順）。
    戻り値: 行ごとの番号の並び（空きマスは None）、番号 → 代表の Glyph、番号 → 出てきた場所 (行, 並びの番号)"""
    ids: dict[bytes, int] = {}
    reps, where = [], collections.defaultdict(list)
    seqs = []
    for li, ln in enumerate(lines):
        seq = []
        for j, g in enumerate(ln.cells):
            if g is None:
                seq.append(None)
                continue
            if g.key not in ids:
                ids[g.key] = len(reps)
                reps.append(g)
            seq.append(ids[g.key])
            where[ids[g.key]].append((li, j))
        seqs.append(seq)
    return seqs, reps, where


def ocr_texts(kind: str, lines: list, cache: str, redo: bool) -> list[list[str]]:
    data = json.load(open(cache, encoding='utf-8')) if os.path.exists(cache) and not redo else {}
    keys = [f'{ln.src}:{ln.index}' for ln in lines]
    todo = [i for i, k in enumerate(keys) if k not in data and lines[i].cells]
    if todo:
        got = read_all([lines[i] for i in todo])
        for i, t in zip(todo, got):
            data[keys[i]] = t
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        with open(cache, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=0)
    return [data.get(k, []) for k in keys]


def read_fixes(path: str) -> dict[str, str]:
    """「画像:行:並びの番号<TAB>文字」→ その場所の字形の文字（空なら字形として使わない）"""
    out = {}
    if os.path.exists(path):
        for line in open(path, encoding='utf-8'):
            if line.startswith('#') or not line.strip():
                continue
            parts = line.rstrip('\n').split('\t')
            out[parts[0]] = parts[1] if len(parts) > 1 else ''
    return out


def decide(votes: dict, n: int, where: dict, lines: list, fixes: dict[str, str]) -> list[dict]:
    """字形の番号ごとに {char, votes, total, ratio, others, fixed}"""
    out = []
    for i in range(n):
        c = votes.get(i) or collections.Counter()
        total = sum(c.values())
        best, n1 = c.most_common(1)[0] if c else ('', 0)
        out.append({'char': best, 'votes': n1, 'total': total, 'ratio': n1 / total if total else 0.0,
                    'others': ' '.join(f'{k}:{v}' for k, v in c.most_common(4)[1:]), 'fixed': False})
    for i, occ in where.items():
        for li, j in occ:
            key = f'{lines[li].src}:{lines[li].index}:{j}'
            if key in fixes:
                out[i]['char'], out[i]['fixed'] = fixes[key], True
    return out


def ground_truth(root: str) -> dict[str, list[str]]:
    """第 1 話の text_ja（画像 → 行ごとの文字列、空白は除く）"""
    ev = json.load(open(os.path.join(root, 'tables', 'evidence.json'), encoding='utf-8'))
    out = {}
    for it in ev['items']:
        t = it.get('text_ja')
        if not t:
            continue
        out[it['image']['name']['ja'] + ':0'] = [t['name']]
        for k, s in enumerate(t['desc'].split('\n')):
            out[it['image']['desc']['ja'] + f':{k}'] = [s]
    return {k: re.sub(r'\s', '', v[0]) for k, v in out.items()}


def script_chars(root: str) -> collections.Counter:
    """日本語の台本（偶数番）に出てくる文字の数"""
    c = collections.Counter()
    for p in sorted(glob.glob(os.path.join(root, 'script', '[0-9][0-9][0-9].txt'))):
        if int(os.path.basename(p)[:3]) % 2:
            continue
        for line in open(p, encoding='utf-8'):
            if line.startswith('== '):
                continue
            c.update(norm(ch) for ch in re.sub(r'\[[^\]]*\]', '', line.rstrip('\n')) if not ch.isspace())
    return c


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    root = args[0] if args else 'assets/extracted'
    redo = '--reocr' in sys.argv
    out_dir = os.path.join(root, 'font')
    work = os.path.join(out_dir, 'small')
    fixes = read_fixes(FIXES)
    truth = ground_truth(root)
    fonts = {}
    loaded = load(root)
    corpus = load_corpus(root)
    for kind in KINDS:
        lines = loaded[kind]
        seqs, reps, where = cluster(lines)
        texts = ocr_texts(kind, lines, os.path.join(work, f"ocr_{'desc' if kind == 'desc' else 'name'}.json"), redo)
        flat = [[i for i in s if i is not None] for s in seqs]
        votes = vote(flat, texts)
        dec = decide(votes, len(reps), where, lines, fixes)
        extra, lex_log = corpus_votes(flat, dec, corpus, weight=0 if kind == 'desc' else 2)
        for i, c in extra.items():
            votes.setdefault(i, collections.Counter()).update(c)
        dec = decide(votes, len(reps), where, lines, fixes)
        raw = decide(votes, len(reps), where, lines, {})
        fonts[kind] = {'raw': raw, 'lines': lines, 'seqs': seqs, 'reps': reps, 'where': where, 'dec': dec, 'texts': texts,
                       'lex': lex_log}
        print(f'{kind}: 行 {len(lines)}、字 {sum(len(f) for f in flat)} 個、字形 {len(reps)} 種類')

    from small_font_out import write_all
    write_all(root, out_dir, work, fonts, truth, script_chars(root))


if __name__ == '__main__':
    main()
