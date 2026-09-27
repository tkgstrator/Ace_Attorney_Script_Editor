# /// script
# dependencies = ["numpy"]
# ///
"""DS 版の画面写真（上画面 256×192）が、取り出したどの背景・人物のコマでできているかを調べる。位置合わせの確認用。

    uv run tools/rom/match_screenshot.py <画面写真.png>... [--root assets/extracted] [--chars 000-060]

1. 背景: data/tail/bg/*.png（左右反転も）と、画面の上 40 行を比べて、いちばん一致するもの
2. 人物: 「anim.tsv の原点を画面の中央 (128, 96) に置く」決まりで各コマを置き、
   テキストウィンドウ（y=144〜）より上で、人物の不透明な点がどれだけ画面と一致するか
色は画像ファイルの値そのもので比べる（DS 版の画面写真には色のプロファイルが付いているが、値は変換しない）。
"""
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

CENTER = (128, 96)
TEXT_TOP = 144
#: 色の差（RGB の差の合計）がこれ未満なら同じ点とみなす
TOL = 12


def load(path: Path, alpha: bool = False) -> np.ndarray:
    w, h = map(int, subprocess.run(['magick', 'identify', '-format', '%w %h', str(path)],
                                   capture_output=True, text=True, check=True).stdout.split())
    fmt = 'rgba' if alpha else 'rgb'
    args = ['magick', str(path)] + ([] if alpha else ['-alpha', 'off']) + ['-depth', '8', f'{fmt}:-']
    raw = subprocess.run(args, capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(h, w, 4 if alpha else 3).astype(int)


def same(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return np.abs(a - b).sum(-1) < TOL


def match_background(shot: np.ndarray, bgs: dict[str, np.ndarray]) -> list[tuple[float, str, bool]]:
    out = []
    for name, bg in bgs.items():
        if bg.shape[:2] != (192, 256):
            continue
        for flip in (False, True):
            b = bg[:, ::-1] if flip else bg
            out.append((float(same(b[:40], shot[:40]).mean()), name, flip))
    return sorted(out, reverse=True)


def match_character(shot: np.ndarray, char_dir: Path, ids: list[str]) -> list[tuple[float, str, str]]:
    out = []
    for a in ids:
        d = char_dir / a
        if not (d / 'anim.tsv').exists():
            continue
        ox, oy = map(int, re.search(r'\((-?\d+), (-?\d+)\)', (d / 'anim.tsv').read_text()).groups())
        for f in sorted(d.glob('f*.png')):
            im = load(f, alpha=True)
            h, w = im.shape[:2]
            x, y = CENTER[0] - ox, CENTER[1] - oy
            ys, ye, xs, xe = max(0, y), min(TEXT_TOP, y + h), max(0, x), min(256, x + w)
            if ye <= ys or xe <= xs:
                continue
            part = im[ys - y:ye - y, xs - x:xe - x]
            opaque = part[..., 3] > 0
            if opaque.sum() < 300:
                continue
            ok = same(part[..., :3], shot[ys:ye, xs:xe]) & opaque
            out.append((float(ok.sum() / opaque.sum()), a, f.name))
    return sorted(out, reverse=True)


def parse_ids(spec: str) -> list[str]:
    ids = []
    for part in spec.split(','):
        lo, _, hi = part.partition('-')
        ids += [f'{i:03}' for i in range(int(lo), int(hi or lo) + 1)]
    return ids


def main() -> None:
    args = sys.argv[1:]
    opts = {}
    for key in ('--root', '--chars'):
        if key in args:
            k = args.index(key)
            opts[key] = args[k + 1]
            del args[k:k + 2]
    if not args:
        sys.exit(__doc__)
    root = Path(opts.get('--root', 'assets/extracted'))
    ids = parse_ids(opts.get('--chars', '000-280'))
    bgs = {p.stem: load(p) for p in sorted((root / 'data/tail/bg').glob('*.png')) if not p.name.startswith('_')}
    for shot_path in args:
        shot = load(Path(shot_path))
        print(f'== {shot_path}')
        for score, name, flip in match_background(shot, bgs)[:2]:
            print(f'  背景 {name}{"（左右反転）" if flip else ""}: 上 40 行の一致 {score:.1%}')
        for score, a, f in match_character(shot, root / 'data/tail/chars/2202220', ids)[:3]:
            print(f'  人物 {a}/{f}: 一致 {score:.1%}')


if __name__ == '__main__':
    main()
