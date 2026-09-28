# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "pillow>=10"]
# ///
"""選択肢（台本 8 / 9）の文を、下画面のボタンの絵から読み、ほかの絵の字形で描き直して確かめる。

    uv run tools/rom/choice_text.py [--reocr] [--game aa2|aa3]

--game aa2 / aa3: 逆転裁判2・3（assets/extracted/aa2・aa3 の中で同じことをする。絵は script_choices.py の GAMES の日本語の
パック、直し表は tools/rom/choice_text_fixes.A2GJ.json / choice_text_fixes.YG3J.json）。

1. 読む: 絵（data/tail/packs/25cf5e4/NNNN.png、日本語）を macOS の文字認識で読む（tools/rom/ocr_boxes.swift。1 字ごとの
   横の範囲も出す）。結果は font/choice/ocr.json に取っておき、--reocr で読み直す。
   読み違いは tools/rom/choice_text_fixes.json の直し表で直す（{絵の番号: [[位置, 消す字数, 入れる文字列], ...]}）。
2. 確かめる: ボタンの字は字形の絵を並べて描いたもので、同じ字はほかの絵でも（ほぼ）同じ点になる。そこで、読んだ文字列を
   「ほかの絵」から切り出した同じ字の字形（文字認識の字の範囲で切り出したもの）で左から順に置き直して描き、元の絵と比べる。
   字ごとに置く位置は、前の字の右隣の近くで、元の絵にいちばん合う所を探す。食い違い（濃さの差の 2 乗の和 / 元の絵の濃さの
   2 乗の和）が RESIDUAL_MAX 以下なら一致とする。字が抜けている・余分・別の字なら食い違いが大きくなる。
   ほかの絵に出てこない字（見本が無い字）があれば描き直せないので、目で見て確かめたもの（直し表の confirmed）だけを通す。
3. 書き出す: tables/choice_text.json（{"items": {"NNNN": 文字列}}）と font/choice/check.txt（一致しないものの一覧）。
   script/json/NNN.json（日本語）の choices の text も直した文にそろえる（script_choices.py も --ocr のときこの表を使う）。

一致しないものが無ければ終了コード 0。前提: macOS（Vision）と swiftc、先に script_json.py <rom> --ocr で script/json を作っておく。
"""
import collections
import glob
import json
import os
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
X = os.path.join(ROOT, 'assets', 'extracted')
PACK = os.path.join(X, 'data', 'tail', 'packs', '25cf5e4')
WORK = os.path.join(X, 'font', 'choice')
FIXES = os.path.join(HERE, 'choice_text_fixes.json')
#: --game で選ぶ 2・3 の置き場所（取り出し先の中のフォルダー、日本語の選択肢のパック、直し表）
GAMES = {'aa2': ('aa2', '08c4464', 'choice_text_fixes.A2GJ.json'),
         'aa3': ('aa3', '0896978', 'choice_text_fixes.YG3J.json')}


BASE_X, BASE_PACK = X, PACK


def add_base_samples(lib: dict) -> None:
    """2・3: 蘇る逆転の確かめた選択肢の絵からも字形の見本を足す（ボタンの字は同じ字形で描かれている）。
    見本の絵の番号は「aa1:NNNN」（2・3 の絵の番号と重ならないように）"""
    global X, PACK
    cache, table = os.path.join(BASE_X, 'font', 'choice', 'ocr.json'), os.path.join(BASE_X, 'tables', 'choice_text.json')
    if not (os.path.exists(cache) and os.path.exists(table)):
        return
    ocr = json.load(open(cache, encoding='utf-8'))
    texts = json.load(open(table, encoding='utf-8'))['items']
    saved = X, PACK
    X, PACK = BASE_X, BASE_PACK
    try:
        ids = [i for i in texts if i in ocr and os.path.exists(os.path.join(PACK, i + '.png'))]
        base = harvest({f'aa1:{i}': ocr[i] for i in ids}, {f'aa1:{i}': darkness(i) for i in ids},
                       {f'aa1:{i}': texts[i] for i in ids})
    finally:
        X, PACK = saved
    for ch, v in base.items():
        lib[ch].extend(v)


def configure(key: str) -> None:
    """2・3 のときに置き場所を切り替える"""
    global X, PACK, WORK, FIXES
    sub, pack, fixes = GAMES[key]
    X = os.path.join(ROOT, 'assets', 'extracted', sub)
    PACK = os.path.join(X, 'data', 'tail', 'packs', pack)
    WORK = os.path.join(X, 'font', 'choice')
    FIXES = os.path.join(HERE, fixes)
#: 字の帯（ボタンの枠の内側）
Y0, Y1, X0, X1 = 5, 27, 19, 237
#: 字の点とみなす濃さ、一致とみなす食い違い、文字認識で拡大する倍率
INK, RESIDUAL_MAX, SCALE = 0.3, 0.03, 3
#: 1 字の字形の幅の上限（ふちの薄い点を含む）
GLYPH_W_MAX = 23


def used_pngs() -> list[str]:
    """日本語の台本の選択肢が使う絵の番号（NNNN）"""
    out = set()
    for p in glob.glob(os.path.join(X, 'script', 'json', '*.json')):
        d = json.load(open(p, encoding='utf-8'))
        if d.get('lang') == 'ja':
            for c in d.get('choices', {}).values():
                out.update(os.path.basename(x)[:-4] for x in c['png'])
    return sorted(out)


def run_ocr(ids: list[str], cache: str, redo: bool) -> dict[str, dict]:
    """番号 → {"text": 文字列, "boxes": [[字, 左端, 右端], ...]}（左端・右端は絵の x 座標）"""
    data = json.load(open(cache, encoding='utf-8')) if os.path.exists(cache) and not redo else {}
    todo = [i for i in ids if i not in data]
    if todo:
        with tempfile.TemporaryDirectory() as td:
            exe = os.path.join(td, 'ocr')
            subprocess.run(['swiftc', '-O', os.path.join(HERE, 'ocr_boxes.swift'), '-o', exe], check=True)
            paths = []
            for i in todo:
                im = Image.open(os.path.join(PACK, i + '.png')).convert('RGBA')
                bg = Image.new('RGBA', im.size, 'white')
                bg.alpha_composite(im)
                q = os.path.join(td, i + '.png')
                bg.convert('RGB').resize((im.width * SCALE, im.height * SCALE)).save(q)
                paths.append(q)
            out = subprocess.run([exe, *paths], check=True, capture_output=True, text=True).stdout
        cur = None
        for line in out.splitlines():
            if line.startswith('# '):
                cur = data[os.path.basename(line[2:])[:-4]] = {'text': '', 'boxes': []}
            elif line.startswith('t\t0\t'):
                cur['text'] += line.split('\t', 2)[2]
            elif line.startswith('c\t'):
                _, ch, a, b = line.split('\t')
                cur['boxes'].append([ch, float(a) * 256, float(b) * 256])
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        with open(cache, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=0)
    return data


def read_fixes(path: str | None = None) -> tuple[dict[str, list], dict[str, int]]:
    """(直し表, 目で確かめた絵の番号 → そのときの文字数（文が変われば確かめ直す）)"""
    path = path or FIXES
    if not os.path.exists(path):
        return {}, {}
    d = json.load(open(path, encoding='utf-8'))
    return d.get('fixes', {}), d.get('confirmed', {})


def apply_fixes(text: str, ops: list) -> str:
    """[[位置, 消す字数, 入れる文字列], ...] を後ろの位置から当てる"""
    for pos, n, ins in sorted(ops, key=lambda o: -o[0]):
        text = text[:pos] + ins + text[pos + n:]
    return text


def darkness(i: str) -> np.ndarray:
    """字の帯の濃さ（0〜1。地の色 246 からの暗さ）"""
    im = Image.open(os.path.join(PACK, i + '.png'))
    pal = np.array(im.getpalette()[:48], float).reshape(16, 3).mean(1)
    lut = np.clip((246 - pal) / 246, 0, None)
    lut[0] = 0
    d = lut[np.array(im)][Y0:Y1].copy()
    d[:, :X0] = 0
    d[:, X1:] = 0
    return d


def harvest(ocr: dict, dark: dict[str, np.ndarray], texts: dict[str, str]) -> dict[str, list]:
    """字 → [(絵の番号, 字形の濃さ)]。直し表で直していない絵の、文字認識の字の範囲から切り出す"""
    lib = collections.defaultdict(list)
    for i, r in ocr.items():
        if i not in dark or texts[i] != r['text']:
            continue
        d = dark[i]
        for ch, a, b in r['boxes']:
            if ch.isspace():
                continue
            a, b = max(X0, round(a)), min(X1, round(b))
            cols = np.nonzero(d[:, a:b].max(0) > INK)[0] if b > a else []
            if len(cols):
                lo, hi = max(0, a + cols.min() - 1), min(256, a + cols.max() + 2)
                lib[ch].append((i, d[:, lo:hi].copy()))
    # 範囲がとなりの字にかかって広すぎるもの（読み落としの跡）は見本にしない
    for ch, v in lib.items():
        med = float(np.median([e.shape[1] for _, e in v]))
        lib[ch] = [(i, e) for i, e in v if e.shape[1] <= min(GLYPH_W_MAX, med * 1.4 + 2)]
    return lib


def rerender(i: str, text: str, d: np.ndarray, lib: dict) -> tuple[float, str]:
    """ほかの絵の字形で描き直した食い違いと、見本の無い字"""
    cols = np.nonzero(d.max(0) > INK)[0]
    pos = int(cols.min()) - 1 if len(cols) else X0
    canvas = np.zeros_like(d)
    missing = ''
    for ch in text:
        if ch.isspace():
            pos += 4
            continue
        shapes = [e for j, e in lib.get(ch, []) if j != i]
        uniq, seen = [], set()
        for e in shapes:
            k = e.tobytes() + bytes([e.shape[1]])
            if k not in seen:
                seen.add(k)
                uniq.append(e)
        if not uniq:
            missing += ch
            pos += 10
            continue
        best = None
        for e in uniq[:40]:
            w = e.shape[1]
            lo = max(0, min(pos - 6, 256 - w))
            for x in range(lo, max(lo, min(256 - w, pos + 14)) + 1):
                old = canvas[:, x:x + w]
                gain = ((np.maximum(old, e) - d[:, x:x + w]) ** 2).sum() - ((old - d[:, x:x + w]) ** 2).sum()
                if best is None or gain < best[0]:
                    best = (gain, x, e)
        _, x, e = best
        canvas[:, x:x + e.shape[1]] = np.maximum(canvas[:, x:x + e.shape[1]], e)
        pos = x + e.shape[1] - 2
    return float(((canvas - d) ** 2).sum() / max(1e-6, (d ** 2).sum())), missing


def update_script_json(table: dict[str, str]) -> int:
    """script/json/NNN.json（日本語）の choices の text を表の文にそろえる。直したファイルの数"""
    n = 0
    for p in sorted(glob.glob(os.path.join(X, 'script', 'json', '*.json'))):
        d = json.load(open(p, encoding='utf-8'))
        if d.get('lang') != 'ja' or not d.get('choices'):
            continue
        changed = False
        for c in d['choices'].values():
            new = [table.get(os.path.basename(x)[:-4], t) for x, t in zip(c['png'], c['text'])]
            if new != c['text']:
                c['text'], changed = new, True
        if changed:
            with open(p, 'w', encoding='utf-8') as f:
                f.write(json.dumps(d, ensure_ascii=False, indent=1) + '\n')
            n += 1
    return n


def main() -> None:
    sys.path.insert(0, HERE)
    from script_choices import FIXES as COMMON  # 文字認識のよくある読み違い（文字列の置き換え）

    if '--game' in sys.argv:
        configure(sys.argv[sys.argv.index('--game') + 1])
    ids = used_pngs()
    ocr = run_ocr(ids, os.path.join(WORK, 'ocr.json'), '--reocr' in sys.argv)
    fixes, confirmed = read_fixes()
    texts = {}
    for i in ids:
        t = ocr[i]['text']
        for a, b in COMMON:
            t = t.replace(a, b)
        texts[i] = apply_fixes(t.strip(), fixes.get(i, []))
    dark = {i: darkness(i) for i in ids}
    lib = harvest(ocr, dark, texts)
    if X != BASE_X:
        add_base_samples(lib)
    rows, n_ok, n_conf = [], 0, 0
    for i in ids:
        res, missing = rerender(i, texts[i], dark[i], lib)
        if res <= RESIDUAL_MAX and not missing:
            n_ok += 1
        elif confirmed.get(i) == len(texts[i]):
            n_conf += 1
        else:
            why = f'見本の無い字 {missing}' if missing else ''
            rows.append(f'{i}\t{res:.3f}\t{texts[i]}\t{why}')
    head = [f'選択肢の絵 {len(ids)}: ほかの絵の字形で描き直して一致 {n_ok}、目で確かめた {n_conf}、一致しない {len(rows)}',
            '# 絵の番号\t食い違い\t読んだ文\t理由']
    os.makedirs(WORK, exist_ok=True)
    with open(os.path.join(WORK, 'check.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(head + rows) + '\n')
    about = f'選択肢の文（下画面のボタンの絵 data/tail/packs/{os.path.basename(PACK)}/NNNN.png を読んだもの。tools/rom/choice_text.py）'
    with open(os.path.join(X, 'tables', 'choice_text.json'), 'w', encoding='utf-8') as f:
        f.write(json.dumps({'_about': about, 'items': texts}, ensure_ascii=False, indent=1) + '\n')
    n = update_script_json(texts)
    print('\n'.join(head + rows[:30]))
    print(f'script/json の {n} ファイルの選択肢の文を直しました')
    sys.exit(1 if rows else 0)


if __name__ == '__main__':
    main()
