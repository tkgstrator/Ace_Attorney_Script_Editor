"""逆転裁判2・3 の法廷記録の名前と説明文を、絵（record/name, record/desc）から読む。record_text.py --game から使う。

蘇る逆転と同じ小さい字（同じ字形）なので、まず蘇る逆転の字形の一覧（font/small/glyphs.json。small_font.py の結果）と
点の並びの完全一致で引く。一覧に無い字形（2・3 にだけ出てくる字）は、蘇る逆転と同じやり方（small_font_ocr.py）で
行ごとに macOS の文字認識で読み、分かっている字を目印にして突き合わせ、字形ごとに多数決で決める。
さらに、前後の分かっている字の並びを台本の文から探し、当てはまる字の票を足す（record_lex23.py）。
台本（<ゲームの置き場所>/script/NNN.txt）は、今のフォントの直し表（font_fixes.<ゲームコード>.tsv）で
script_dump.py が書き出したものを使う（古い読みの台本だと票も、名前の種類の決め方（load_game）も狂う）。
確かめ方: record_text_verify.py --game（台本・空き欄・年齢の形など）、record_text_check.py --game（描き直し）。
目で見て直したものは tools/rom/record_text_fixes.<ゲームコード>.json に置く:
  glyphs: {"画像:行:並びの番号": 文字}  その場所の字形の文字（同じ字形の全部の場所に効く。空きマスも数える）
  fixes:  {項目の番号: {欄: [[行, 並びの番号, 文字], ...]}}  場所ごとの直し（record_text_fixes.json と同じ形）
出力: <ゲームの置き場所>/tables/record_text.json（蘇る逆転と同じ形）と、確認用の font/small/record_review.tsv
（蘇る逆転の一覧に無い字形ごとの、当てた文字・票・最初に出てくる場所・その行）。文字認識の結果は
font/small/ocr_{desc,name}.json に取っておく（--reocr で読み直す）。
"""
import collections
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from record_glyphs import UNKNOWN, X, load_fonts  # noqa: E402
from small_font import cluster, has_age, load, ocr_texts  # noqa: E402
from record_lex23 import bracket_votes, lex_votes, load_text  # noqa: E402
from small_font_ocr import CONFIDENT, MIN_VOTES, align, norm  # noqa: E402
from small_font_seg import Glyph, crop  # noqa: E402

KINDS = ('desc', 'name', 'profile')
#: 名前の 1 字の幅の上限（これより広いかたまりは 2 字）
NAME_MAX_W = 13
#: 最後でない字の幅の上限。「手」「迫」「ブ」（3 の 035・037・042）は 1 字で 14 点ある。最後の 14 点のかたまりは
#: 年齢の「3）」が 1 マスに入ったもの（3 の 056）なので NAME_MAX_W で分ける
NAME_MID_MAX_W = 14
#: 送りが決まらない名前の行で、これ以上あいた字の間は空きマス
NAME_SPACE = 8
#: 空きマスを入れる前後の字の幅の下限（かっこ・数字・細いかなは字の中に余白があるので数えない）
NAME_SPACE_W = 9
#: 名前の字形を引くとき、見つからなければもう一方の名前の字形も見る（証拠品と人物ファイルの分け方の違いに備える）
FALLBACK = {'desc': (), 'name': ('profile',), 'profile': ('name',)}


def fixes_path(code: str) -> str:
    return os.path.join(HERE, f'record_text_fixes.{code}.json')


def read_game_fixes(code: str) -> tuple[dict[str, str], dict]:
    """(場所 → 字形の文字, 項目ごとの直し（record_text.read_fixes と同じ形）)"""
    p = fixes_path(code)
    if not os.path.exists(p):
        return {}, {}
    data = json.load(open(p, encoding='utf-8'))
    items = {(int(k), f): [tuple(x) for x in v] for k, fs in data.get('fixes', {}).items() for f, v in fs.items()}
    return data.get('glyphs', {}), items


def split_wide(line) -> None:
    """名前の行で、2 字がくっついて 1 つのかたまりになったもの（幅が 1 字より広い）を、点の少ない列で 2 つに分ける
    （2・3 には 10 字の名前があり、字の送りが 14 より詰まる。送りが決まった行でも「3）」が 1 マスに入ることがある）。
    送りが決まらない行で広くあいた字の間には空きマスを入れる"""
    cells = []
    todo = list(line.cells)
    while todo:
        g = todo.pop(0)
        w = g.bits.shape[1] if g is not None else 0
        last = all(x is None for x in todo)
        if w <= (NAME_MAX_W if last else NAME_MID_MAX_W):
            cells.append(g)
            continue
        cols = g.bits.sum(0)
        lo, hi = max(6, w - NAME_MAX_W), min(w - 6, NAME_MAX_W)
        c = min(range(lo, hi + 1), key=lambda x: (cols[x], abs(x - w / 2)))
        parts = []
        for a, b in ((0, c), (c, w)):
            got = crop(g.bits[:, a:b])
            if got is not None:
                bits, cx, cy = got
                parts.append(Glyph(bits, None, g.dy + cy, g.x + a + cx, g.y + cy))
        todo[:0] = parts
    # 姓と名の間の空きマス（字の間が NAME_SPACE 点以上。細い字（NAME_SPACE_W 未満）の前後は数えない）
    out = []
    for g in cells:
        prev = out[-1] if out else None
        if (prev is not None and g is not None and min(prev.bits.shape[1], g.bits.shape[1]) >= NAME_SPACE_W
                and g.x - (prev.x + prev.bits.shape[1]) >= NAME_SPACE):
            out.append(None)
        out.append(g)
    line.cells = out


def seed_chars(kind: str, reps: list, fonts: dict) -> dict[int, str]:
    """蘇る逆転の字形の一覧で引ける字形 → 文字"""
    out = {}
    for i, g in enumerate(reps):
        for k in (kind, *FALLBACK[kind]):
            ch = fonts[k].shapes.get(g.key)
            if ch:
                out[i] = ch
                break
    return out


def vote(seqs: list[list[int]], texts: list[list[str]], seed: dict[int, str], rounds: int = 4) -> dict[int, collections.Counter]:
    """読んだ文字列を突き合わせて字形ごとの票を数える（small_font_ocr.vote に、分かっている字形を最初から目印に足したもの）"""
    known = dict(seed)
    votes: dict[int, collections.Counter] = {}
    for _ in range(rounds):
        votes = collections.defaultdict(collections.Counter)
        for ids, ts in zip(seqs, texts):
            if not ids:
                continue
            for t in ts:
                for i, ch in align(ids, ''.join(c for c in t if not c.isspace()), known):
                    votes[i][ch] += 1
        known = dict(seed)
        for i, c in votes.items():
            (best, n1), total = c.most_common(1)[0], sum(c.values())
            if i not in seed and n1 >= MIN_VOTES and n1 / total >= CONFIDENT:
                known[i] = best
    return votes


def decide(n: int, seed: dict[int, str], votes: dict) -> list[dict]:
    out = []
    for i in range(n):
        if i in seed:
            out.append({'char': seed[i], 'votes': 99, 'total': 99, 'ratio': 1.0, 'others': '', 'seed': True})
            continue
        c = votes.get(i) or collections.Counter()
        total = sum(c.values())
        best, n1 = c.most_common(1)[0] if c else (UNKNOWN, 0)
        out.append({'char': best, 'votes': n1, 'total': total, 'ratio': n1 / total if total else 0.0,
                    'others': ' '.join(f'{k}:{v}' for k, v in c.most_common(4)[1:]), 'seed': False})
    return out


def read_kind(kind: str, lines: list, root: str, fonts: dict, corpus, glyph_fixes: dict[str, str], redo: bool):
    """1 種類の行を読み、(行ごとの字の並び（空きマスは '　'）, 確認用の行) を返す"""
    seqs, reps, where = cluster(lines)
    seed = seed_chars(kind, reps, fonts)
    cache = os.path.join(root, 'font', 'small', f"ocr_{'desc' if kind == 'desc' else 'name'}.json")
    texts = ocr_texts(kind, lines, cache, redo) if len(seed) < len(reps) else [[] for _ in lines]
    flat = [[i for i in s if i is not None] for s in seqs]
    votes = vote(flat, texts, seed)
    dec = decide(len(reps), seed, votes)
    extra = [lex_votes(flat, seed, corpus)] + ([bracket_votes(flat, seed, corpus)] if kind == 'name' else [])
    for ev in extra:
        for i, c in ev.items():
            votes.setdefault(i, collections.Counter()).update(c)
    dec = decide(len(reps), seed, votes)
    for i, occ in where.items():
        for li, j in occ:
            key = f'{lines[li].src}:{lines[li].index}:{j}'
            if key in glyph_fixes:
                if i in seed:
                    # 蘇る逆転の字形と点まで同じ字は直さない（場所の数え違いの印。項目ごとの直し fixes を使う）
                    print(f'直し表: {key} は蘇る逆転の字形「{seed[i]}」なので「{glyph_fixes[key]}」にしない')
                    continue
                dec[i].update(char=glyph_fixes[key], fixed=True)
    rows = [['　' if i is None else norm(dec[i]['char']) for i in s] for s in seqs]
    #: 並びごとの印（蘇る逆転の字形で引けなかった字は、直していなければ '?'、直したものは '!'）
    marks = [['' if i is None or dec[i]['seed'] and not dec[i].get('fixed') else '!' if dec[i].get('fixed') else '?'
              for i in s] for s in seqs]
    review = []
    for i, d in enumerate(dec):
        if d['seed']:
            continue
        li, j = where[i][0]
        review.append('\t'.join([kind, str(i), d['char'], str(d['votes']), str(d['total']), f"{d['ratio']:.2f}", d['others'],
                                 'fixed' if d.get('fixed') else '', str(len(where[i])),
                                 f'{lines[li].src}:{lines[li].index}:{j}', ''.join(rows[li])]))
    return rows, marks, review


def filed_kinds(root: str) -> dict[str, set[str]]:
    """名前の絵 → 法廷記録への入れ方（evidence / profile。話の最初の中身と台本の record_add / record_swap）"""
    from record_text_verify import filed, script_ops
    with open(os.path.join(root, 'tables', 'evidence.json'), encoding='utf-8') as f:
        ev_doc = json.load(f)
    into = filed(ev_doc, script_ops(root))
    out: dict[str, set[str]] = {}
    for it in ev_doc['items']:
        src = it.get('image', {}).get('name', {}).get('ja')
        if src and it['id'] in into:
            out.setdefault(src, set()).update(into[it['id']])
    return out


def load_game(root: str) -> dict[str, list]:
    """種類 → 行の一覧（small_font.load に、名前の字を分け直して年齢付きを人物ファイルにしたもの）。
    2・3 の名前の字形は証拠品と人物ファイルで同じなので、絵の形では分けられない。法廷記録への入れ方が 1 通りの名前は
    それに合わせる（年齢の無い人物ファイル「アヤサトキョウコ」、かっこ付きの証拠品「上面図（綾里家）」など）"""
    loaded = load(root)
    for kind in ('name', 'profile'):
        for ln in loaded[kind]:
            split_wide(ln)
    # 分けたあとで年齢のかっこが最後に来た名前は人物ファイル（small_font.split_names と同じ決め方）
    for ln in loaded['name']:
        if has_age(ln):
            ln.kind = 'profile'
    kinds = filed_kinds(root)
    for ln in loaded['name'] + loaded['profile']:
        k = kinds.get(ln.src, set())
        if len(k) == 1:
            ln.kind = 'profile' if k == {'profile'} else 'name'
    lines = loaded['name'] + loaded['profile']
    loaded['name'] = [ln for ln in lines if ln.kind == 'name']
    loaded['profile'] = [ln for ln in lines if ln.kind == 'profile']
    return loaded


def game_lines(root: str) -> dict[str, list]:
    """絵の相対パス → 行の一覧（record_glyphs.record_lines と同じ形で、字の分け方は load_game）"""
    out: dict[str, list] = {}
    for lines in load_game(root).values():
        for ln in lines:
            out.setdefault(ln.src, []).append(ln)
    for v in out.values():
        v.sort(key=lambda ln: ln.index)
    return out


def read_all(root: str, code: str, redo: bool = False) -> tuple[dict, dict[str, str], list[str], dict]:
    """画像 → 行ごとの字の並び、画像 → 名前の字の種類（name / profile）、確認用の行、画像 → 行ごとの印（read_kind）"""
    fonts = load_fonts(X)
    loaded = load_game(root)
    corpus = load_text(root)
    glyph_fixes, _ = read_game_fixes(code)
    by_src: dict[str, list] = {}
    kinds: dict[str, str] = {}
    review = []
    for kind in KINDS:
        lines = loaded[kind]
        rows, marks, rv = read_kind(kind, lines, root, fonts, corpus, glyph_fixes, redo)
        review += rv
        for ln, r, m in zip(lines, rows, marks):
            by_src.setdefault(ln.src, []).append((ln.index, r, m))
            kinds[ln.src] = kind
    rows_by = {k: [r for _, r, _m in sorted(v, key=lambda x: x[0])] for k, v in by_src.items()}
    marks_by = {k: [m for _, _r, m in sorted(v, key=lambda x: x[0])] for k, v in by_src.items()}
    return rows_by, kinds, review, marks_by


def items(root: str) -> list[dict]:
    ev = json.load(open(os.path.join(root, 'tables', 'evidence.json'), encoding='utf-8'))
    out = []
    for it in ev['items']:
        img = it.get('image', {})
        name, desc = (img.get(k, {}).get('ja') or '' for k in ('name', 'desc'))
        if name or desc:
            out.append({'id': it['id'], 'name': name, 'desc': desc})
    return out


def run(game, out: str | None = None, redo: bool = False) -> None:
    from record_text import to_text
    root = str(game.out)
    out = out or os.path.join(root, 'tables', 'record_text.json')
    rows_by_src, kinds, review, _marks = read_all(root, game.code, redo)
    _, fixes = read_game_fixes(game.code)
    res, unknown = {}, []
    for it in items(root):
        fields = {}
        for field in ('name', 'desc'):
            rows = [list(r) for r in rows_by_src.get(it[field], [])]
            for li, j, ch in fixes.get((it['id'], field), []):
                rows[li][j] = ch
            fields[field] = to_text(rows, field == 'name' and kinds.get(it['name']) == 'profile')
        if UNKNOWN in fields['name'] + fields['desc']:
            unknown.append(it['id'])
        if fields['name'] or fields['desc']:
            res[str(it['id'])] = fields
    about = (f'{game.title} の法廷記録の名前と説明文（蘇る逆転の小さい字の字形と完全一致で引き、無い字形は文字認識の多数決。'
             'tools/rom/record_text.py --game、tools/rom/record_text23.py）')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(json.dumps({'_about': about, 'items': res}, ensure_ascii=False, indent=1) + '\n')
    rv_path = os.path.join(root, 'font', 'small', 'record_review.tsv')
    os.makedirs(os.path.dirname(rv_path), exist_ok=True)
    head = '# 種類\t字形\t文字\t票\t全票\t割合\tほかの票\t直し\t出てくる数\t最初の場所\tその行'
    with open(rv_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join([head, *review]) + '\n')
    weak = sum(1 for r in review if float(r.split('\t')[5]) < CONFIDENT and r.split('\t')[7] != 'fixed')
    print(f'{out}: {len(res)} 項目、蘇る逆転に無い字形 {len(review)}（確かさの低いもの {weak}）'
          + (f'（読めない字のある項目: {unknown}）' if unknown else ''))
    print(f'→ {rv_path}')
