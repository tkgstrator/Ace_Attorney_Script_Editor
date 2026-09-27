# /// script
# dependencies = ["numpy"]
# ///
"""立ち位置（弁護側・検察側・証言台・裁判長）ごとに、DS 版の人物と机の画面上の寸法を測る。

    uv run tools/rom/measure_stands.py [assets/extracted] [--json 出力先]

入力: extract_assets.py が作った data/tail/chars/2202220/NNN/（f00.png と anim.tsv）と data/desks/*.png。
人物は anim.tsv の原点を画面の中央 (128, 96) に置く（DS 版の画面と点の単位で一致することを確かめた置き方）。
出力: 画面（256×192）の座標での寸法を表で表示し、--json があれば JSON にも書く。
      数値だけなので、絵そのものは含まない（tools/sprites/STAND_SPEC.md の元データ）。
"""
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

SCREEN_W, SCREEN_H = 256, 192
CENTER = (128, 96)
#: 測る人物（立ち位置, アニメーション番号, 説明）。どれも第 1 話の通常の姿
TARGETS = [
    ('defense', '000', '成歩堂（通常）'),
    ('defense', '001', '成歩堂（書類）'),
    ('prosecution', '019', '御剣（通常）'),
    ('prosecution', '042', '亜内（通常）'),
    ('witness', '053', 'ヤマノ（通常）'),
    ('witness', '044', '矢張（通常）'),
    ('judge', '018', '裁判長（通常）'),
]


def load_rgba(path: Path) -> np.ndarray:
    w, h = map(int, subprocess.run(['magick', 'identify', '-format', '%w %h', str(path)],
                                   capture_output=True, text=True, check=True).stdout.split())
    raw = subprocess.run(['magick', str(path), '-depth', '8', 'rgba:-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(h, w, 4)


def place(img: np.ndarray, x: int, y: int) -> np.ndarray:
    """不透明な点を画面の大きさの真偽値の配列に置く"""
    out = np.zeros((SCREEN_H, SCREEN_W), bool)
    h, w = img.shape[:2]
    ys, xs = max(0, y), max(0, x)
    ye, xe = min(SCREEN_H, y + h), min(SCREEN_W, x + w)
    if ye > ys and xe > xs:
        out[ys:ye, xs:xe] = img[ys - y:ye - y, xs - x:xe - x, 3] > 0
    return out


def span(mask: np.ndarray, y: int) -> tuple[int, int] | None:
    xs = np.nonzero(mask[y])[0]
    return (int(xs.min()), int(xs.max())) if len(xs) else None


def measure_char(root: Path, anim: str) -> dict:
    d = root / 'data/tail/chars/2202220' / anim
    ox, oy = map(int, re.search(r'\((-?\d+), (-?\d+)\)', (d / 'anim.tsv').read_text()).groups())
    m = place(load_rgba(d / 'f00.png'), CENTER[0] - ox, CENTER[1] - oy)
    ys, xs = np.nonzero(m)
    top, bottom = int(ys.min()), int(ys.max())
    widths = {y: span(m, y) for y in range(top, bottom + 1)}
    # 頭: 上から見て、幅がいちばん狭くなる所（首）までを頭とみなす（上から 80 ドットの範囲で探す）
    search = [y for y in range(top + 12, min(bottom, top + 80)) if widths[y]]
    neck = min(search, key=lambda y: widths[y][1] - widths[y][0]) if search else top
    head = [widths[y] for y in range(top, neck) if widths[y]]
    head_x0, head_x1 = min(a for a, _ in head), max(b for _, b in head)
    return {
        'anim': anim, 'origin_in_image': [ox, oy],
        'bbox': {'x0': int(xs.min()), 'x1': int(xs.max()), 'y0': top, 'y1': bottom},
        'head': {'top': top, 'neck_y': neck, 'x0': head_x0, 'x1': head_x1, 'center_x': (head_x0 + head_x1) // 2},
        'shoulders': span(m, min(bottom, neck + 20)),
        'mask': m,
    }


def main() -> None:
    args = sys.argv[1:]
    out_json = None
    if '--json' in args:
        k = args.index('--json')
        out_json = args[k + 1]
        del args[k:k + 2]
    root = Path(args[0] if args else 'assets/extracted')
    desks = {}
    for p in sorted((root / 'data/desks').glob('*.png')):
        m = load_rgba(p)[..., 3] > 0
        ys, xs = np.nonzero(m)
        desks[p.stem] = {'top': int(ys.min()), 'x0': int(xs.min()), 'x1': int(xs.max()), 'mask': m}
    result = {'screen': [SCREEN_W, SCREEN_H], 'desks': {}, 'characters': []}
    for k, v in desks.items():
        result['desks'][k] = {x: v[x] for x in ('top', 'x0', 'x1')}
        print(f'机 {k:12} 上端 y={v["top"]}  x {v["x0"]}〜{v["x1"]}')
    for stand, anim, label in TARGETS:
        if not (root / 'data/tail/chars/2202220' / anim / 'anim.tsv').exists():
            continue
        c = measure_char(root, anim)
        m = c.pop('mask')
        c.update(stand=stand, label=label)
        if stand in desks:
            hidden = m & desks[stand]['mask']
            c['below_desk_rows'] = c['bbox']['y1'] - desks[stand]['top'] + 1
            c['hidden_px'] = int(hidden.sum())
        result['characters'].append(c)
        b, h = c['bbox'], c['head']
        print(f'{stand:12} {anim} {label:10} 範囲 x {b["x0"]}〜{b["x1"]} y {b["y0"]}〜{b["y1"]}  '
              f'頭 y {h["top"]}〜{h["neck_y"]}（幅 {h["x1"] - h["x0"] + 1}、中心 x {h["center_x"]}）  '
              f'肩 {c["shoulders"]}  机の下 {c.get("below_desk_rows", "-")} 行')
    if out_json:
        Path(out_json).write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        print(f'書き出しました: {out_json}')


if __name__ == '__main__':
    main()
