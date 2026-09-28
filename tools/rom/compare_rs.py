# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "pillow>=10"]
# ///
"""Rust 版（crates/aa-extract）の出力を Python 版の出力と比べる。

    uv run tools/rom/compare_rs.py [Python 版の出力（assets/extracted-py）] [Rust 版の出力（assets/extracted-rs）]
        [--only 前方一致のパス,...] [--list 20]

比べ方:
  .png   画素（RGBA に直したもの）と大きさ。ファイルの中身（圧縮）は違ってよい
  .gif   コマの数・各コマの表示される画素（透明な所は色を見ない）・表示時間・繰り返し
  .json  読んだ値が同じか。バイト単位でも同じかを数える。音の JSON（sound/rendered/）の浮動小数点は
         FLOAT_TOL の相対誤差まで許す（FFT・log10 など numpy と Rust で最後の桁が違いうるもの）。ogg は比べない
  .wav   見出し（チャンネル数・幅・周波数）とサンプルがすべて同じか
  その他 バイト単位で同じか
比べないもの（IGNORE）: ImageMagick で作る一覧画像（_sheet.png）、ffmpeg の .ogg、sdatxtract の変換、フォントの入力（OCR の結果）
"""
import json
import math
import sys
import wave
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
IGNORE_NAMES = {'.DS_Store', 'review.txt'}
IGNORE_SUFFIX = {'.ogg', '.gray'}
IGNORE_PREFIX = ('sound/converted/', 'font/YG3J/', 'font/A2GJ/', 'font/AGCJ/', 'font/BXOJ/', 'font/mapping.tsv')
# 浮動小数点を誤差つきで比べる JSON の鍵（sound/rendered の確かめの値）
FLOAT_TOL = 1e-9
LOOSE_KEYS = {'rmsDb', 'centroidHz', 'seamRms', 'seamError'}
SKIP_KEYS = {'ogg'}


def ignored(rel: str) -> bool:
    name = rel.rsplit('/', 1)[-1]
    return (name in IGNORE_NAMES or name.startswith('_sheet') or Path(rel).suffix in IGNORE_SUFFIX
            or rel.startswith(IGNORE_PREFIX) or name.startswith('.err_'))


def files(root: Path) -> set[str]:
    return {str(p.relative_to(root)) for p in root.rglob('*') if p.is_file() and not ignored(str(p.relative_to(root)))}


def gif_frames(p: Path) -> tuple[list[np.ndarray], list[int], object]:
    """GIF の各コマ（表示される RGBA、透明な所の色は 0）と表示時間（ミリ秒）と繰り返し"""
    frames, durs = [], []
    with Image.open(p) as im:
        loop = im.info.get('loop')
        for k in range(getattr(im, 'n_frames', 1)):
            im.seek(k)
            a = np.array(im.convert('RGBA'))
            a[a[..., 3] == 0] = 0
            frames.append(a)
            durs.append(im.info.get('duration'))
    return frames, durs, loop


def rgba(p: Path) -> np.ndarray:
    with Image.open(p) as im:
        return np.asarray(im.convert('RGBA'))


def json_diff(a, b, path='', loose=False, allow=False) -> str | None:
    """最初に違う所の説明（同じなら None）。allow なら LOOSE_KEYS の下の浮動小数点は誤差を許す"""
    if isinstance(a, dict) and isinstance(b, dict):
        ka = [k for k in a if k not in SKIP_KEYS]
        kb = [k for k in b if k not in SKIP_KEYS]
        if sorted(ka) != sorted(kb):
            return f'{path}: 鍵が違う {sorted(set(ka) ^ set(kb))}'
        for k in ka:
            r = json_diff(a[k], b[k], f'{path}.{k}', loose or (allow and k in LOOSE_KEYS), allow)
            if r:
                return r
        return None
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return f'{path}: 長さ {len(a)} != {len(b)}'
        for i, (x, y) in enumerate(zip(a, b)):
            r = json_diff(x, y, f'{path}[{i}]', loose, allow)
            if r:
                return r
        return None
    if isinstance(a, float) and isinstance(b, (int, float)) and loose:
        if (math.isnan(a) and math.isnan(b)) or a == b:
            return None
        if math.isfinite(a) and math.isfinite(b) and abs(a - b) <= FLOAT_TOL * max(abs(a), abs(b), 1e-300):
            return None
        return f'{path}: {a!r} != {b!r}'
    if type(a) is not type(b) or a != b:
        if isinstance(a, float) and isinstance(b, float) and math.isnan(a) and math.isnan(b):
            return None
        return f'{path}: {a!r} != {b!r}'
    return None


def compare(args) -> tuple[str, str, str]:
    """(パス, 結果 = same / same_bytes / same_value / loose / diff, 説明)"""
    rel, ra, rb = args
    a, b = Path(ra) / rel, Path(rb) / rel
    ba, bb = a.read_bytes(), b.read_bytes()
    if ba == bb:
        return rel, 'same_bytes', ''
    suf = a.suffix
    try:
        if suf == '.png':
            x, y = rgba(a), rgba(b)
            if x.shape != y.shape:
                return rel, 'diff', f'大きさ {x.shape} != {y.shape}'
            n = int(np.count_nonzero((x != y).any(axis=2)))
            return (rel, 'same_value', '') if n == 0 else (rel, 'diff', f'画素が {n} 個違う')
        if suf == '.gif':
            (fa, da, la), (fb, db, lb) = gif_frames(a), gif_frames(b)
            if len(fa) != len(fb):
                return rel, 'diff', f'コマの数 {len(fa)} != {len(fb)}'
            if da != db or la != lb:
                return rel, 'diff', f'表示時間・繰り返しが違う {da} / {db}, {la} / {lb}'
            bad = [k for k, (x, y) in enumerate(zip(fa, fb)) if x.shape != y.shape or (x != y).any()]
            return (rel, 'same_value', '') if not bad else (rel, 'diff', f'コマ {bad[:5]} の画素が違う')
        if suf == '.json':
            ja, jb = json.loads(ba), json.loads(bb)
            strict = json_diff(ja, jb, '', False)
            if strict is None:
                return rel, 'same_value', ''
            loose = json_diff(ja, jb, '', False, True)
            return (rel, 'loose', strict) if loose is None else (rel, 'diff', loose)
        if suf == '.wav':
            with wave.open(str(a)) as wa, wave.open(str(b)) as wb:
                pa, pb = wa.getparams()[:3], wb.getparams()[:3]
                fa, fb = wa.readframes(wa.getnframes()), wb.readframes(wb.getnframes())
            if pa != pb:
                return rel, 'diff', f'見出し {pa} != {pb}'
            if fa == fb:
                return rel, 'same_value', ''
            x, y = np.frombuffer(fa, '<i2'), np.frombuffer(fb, '<i2')
            if len(x) != len(y):
                return rel, 'diff', f'サンプル数 {len(x) // 2} != {len(y) // 2}'
            d = np.abs(x.astype(np.int32) - y)
            return rel, 'diff', f'違うサンプル {int(np.count_nonzero(d))}、最大の差 {int(d.max())}'
    except Exception as e:  # noqa: BLE001
        return rel, 'diff', f'読めない: {e}'
    return rel, 'diff', f'バイトが違う（{len(ba)} / {len(bb)} バイト）'


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    only = []
    if '--only' in sys.argv:
        only = sys.argv[sys.argv.index('--only') + 1].split(',')
        args = [a for a in args if a != sys.argv[sys.argv.index('--only') + 1]]
    nlist = int(sys.argv[sys.argv.index('--list') + 1]) if '--list' in sys.argv else 20
    if '--list' in sys.argv:
        args = [a for a in args if a != str(nlist)]
    ra = Path(args[0]) if args else ROOT / 'assets/extracted-py'
    rb = Path(args[1]) if len(args) > 1 else ROOT / 'assets/extracted-rs'
    fa, fb = files(ra), files(rb)
    if only:
        fa = {f for f in fa if f.startswith(tuple(only))}
        fb = {f for f in fb if f.startswith(tuple(only))}
    missing, extra = sorted(fa - fb), sorted(fb - fa)
    both = sorted(fa & fb)
    with ProcessPoolExecutor() as ex:
        res = list(ex.map(compare, [(r, str(ra), str(rb)) for r in both], chunksize=64))
    cats: dict[str, dict[str, int]] = {}
    diffs = []
    for rel, kind, note in res:
        top = '/'.join(rel.split('/')[:2]) if rel.count('/') >= 2 else rel.split('/')[0]
        c = cats.setdefault(top, {})
        c[kind] = c.get(kind, 0) + 1
        if kind in ('diff', 'loose'):
            diffs.append((rel, kind, note))
    for f in missing:
        top = '/'.join(f.split('/')[:2]) if f.count('/') >= 2 else f.split('/')[0]
        c = cats.setdefault(top, {})
        c['missing'] = c.get('missing', 0) + 1
    for f in extra:
        top = '/'.join(f.split('/')[:2]) if f.count('/') >= 2 else f.split('/')[0]
        c = cats.setdefault(top, {})
        c['extra'] = c.get('extra', 0) + 1
    print(f'比べたもの: {ra} ↔ {rb}')
    print(f'{"分類":32} {"バイト同一":>10} {"値が同一":>8} {"誤差内":>6} {"違う":>6} {"無い":>6} {"余分":>6}')
    for k in sorted(cats):
        c = cats[k]
        print(f'{k:32} {c.get("same_bytes", 0):>10} {c.get("same_value", 0):>8} {c.get("loose", 0):>6} '
              f'{c.get("diff", 0):>6} {c.get("missing", 0):>6} {c.get("extra", 0):>6}')
    n_diff = sum(1 for d in diffs if d[1] == 'diff')
    print(f'\n合計: {len(both)} 個を比べ、違う {n_diff}、誤差内 {len(diffs) - n_diff}、無い {len(missing)}、余分 {len(extra)}')
    for rel, kind, note in [d for d in diffs if d[1] == 'diff'][:nlist]:
        print(f'  違う: {rel}: {note}')
    for rel, kind, note in [d for d in diffs if d[1] == 'loose'][:nlist]:
        print(f'  誤差内: {rel}: {note}')
    for f in missing[:nlist]:
        print(f'  無い: {f}')
    for f in extra[:nlist]:
        print(f'  余分: {f}')
    sys.exit(1 if n_diff or missing or extra else 0)


if __name__ == '__main__':
    main()
