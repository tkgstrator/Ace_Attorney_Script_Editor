# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "pillow"]
# ///
"""書き出した机を、背景と人物のコマに重ねて実機のスクリーンショットと比べる（確認用）。

    uv run tools/rom/check_desks.py [比べた画像の書き出し先]

重ね方: 背景（data/tail/bg）→ 人物（chars の anim.tsv の原点を画面の (128, 96) に置く）→ 机（data/desks）。
色は 5 ビット（DS の色の精度）に丸めてから比べる。テキストウィンドウなどで隠れる所は数えないよう、
場面ごとに比べる範囲を決めてある。結果は「一致した画素の割合」と、左から 重ねた絵・実機・違う所 を並べた画像。
"""
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
EX = ROOT / 'assets/extracted/data'
SHOTS = ROOT / 'assets/samples/ds/top'
ORIGIN = (128, 96)          # anim.tsv の原点が来る画面上の位置（上画面 256×192）

# 名前: (背景, 人物のアニメーション, コマ, スクリーンショット, 比べる範囲 (y0, y1, x0, x1))
CASES = {
    'defense': ('bg003_1c41668', '001', 'f02', 'dialogue/20260927_12-15-29.721', (0, 192, 0, 256)),
    'prosecution': ('bg004_1c43634', '042', 'f00', 'dialogue/20260927_11-17-26.149', (0, 192, 0, 256)),
    'witness': ('bg005_1c4548c', '055', 'f02', 'character-only/20260927_13-11-48.225', (0, 192, 0, 256)),
    'judge': ('bg008_1c57304', '018', 'f00', 'dialogue/20260927_11-17-20.424', (0, 192, 0, 256)),
}
TEXTBOX_Y = 130             # これより下は名前欄とテキストウィンドウ（character-only の画像には無い）
WINDOW = (150, 186, 8, 248)  # テキストウィンドウの中（半透明で暗くなっている）の範囲 (y0, y1, x0, x1)


def rgba(path: Path) -> np.ndarray:
    return np.array(Image.open(path).convert('RGBA'))


def over(dst: np.ndarray, src: np.ndarray, x: int, y: int) -> None:
    """src（RGBA）の不透明な画素を dst の (x, y) に置く（はみ出す所は切る）"""
    h, w = src.shape[:2]
    x0, y0 = max(x, 0), max(y, 0)
    x1, y1 = min(x + w, dst.shape[1]), min(y + h, dst.shape[0])
    if x0 >= x1 or y0 >= y1:
        return
    s = src[y0 - y:y1 - y, x0 - x:x1 - x]
    np.copyto(dst[y0:y1, x0:x1], s, where=s[..., 3:] > 0)


def compose(bg: str, char: str, frame: str, desk: str | None) -> np.ndarray:
    can = rgba(EX / 'tail/bg' / f'{bg}.png')
    d = EX / 'tail/chars/2202220' / char
    ox, oy = map(int, re.search(r'\((-?\d+), (-?\d+)\)', (d / 'anim.tsv').read_text()).groups())
    over(can, rgba(d / f'{frame}.png'), ORIGIN[0] - ox, ORIGIN[1] - oy)
    if desk and (EX / 'desks' / f'{desk}.png').exists():
        over(can, rgba(EX / 'desks' / f'{desk}.png'), 0, 0)
    return can


def q5(a: np.ndarray) -> np.ndarray:
    return np.rint(a[..., :3].astype(int) * 31 / 255).astype(int)


def window_err(ours: np.ndarray, ref: np.ndarray) -> float:
    """テキストウィンドウは半透明で下の絵を暗くして見せるので、ウィンドウの中では ref ≈ a × ours + b が
    成り立つはず。色ごとに a, b を最小二乗で当てはめたときの平均の誤差（0〜255）を返す。
    文字（明るい画素）とその周りは除く"""
    y0, y1, x0, x1 = WINDOW
    o = ours[y0:y1, x0:x1, :3].reshape(-1, 3).astype(float)
    r = ref[y0:y1, x0:x1, :3].reshape(-1, 3).astype(float)
    bright = ref[y0:y1, x0:x1, :3].max(-1) > 160
    near = np.zeros_like(bright)
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            near |= np.roll(np.roll(bright, dy, 0), dx, 1)
    k = ~near.reshape(-1)
    err = []
    for c in range(3):
        a, b = np.polyfit(o[k, c], r[k, c], 1)
        err.append(np.abs(a * o[k, c] + b - r[k, c]).mean())
    return float(np.mean(err))


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    for name, (bg, char, frame, shot, (y0, y1, x0, x1)) in CASES.items():
        ours = compose(bg, char, frame, name)
        ref = rgba(SHOTS / f'{shot}.png')
        same = (q5(ours) == q5(ref)).all(-1)
        area = np.zeros_like(same)
        area[y0:y1, x0:x1] = True
        if 'character-only' not in shot:
            area[TEXTBOX_Y:] = False
        desk = rgba(EX / 'desks' / f'{name}.png')[..., 3] > 0 if name != 'judge' else np.zeros_like(same)
        vis = area & desk
        msg = f'  {name}: 全体 {same[area].mean():.3f}'
        if vis.any():
            msg += f'、机の画素（比べた範囲のうち {vis.sum()} 画素）{same[vis].mean():.3f}'
        if 'character-only' not in shot:
            bare = compose(bg, char, frame, None)
            msg += f'、ウィンドウ越しの誤差 机あり {window_err(ours, ref):.1f} / 机なし {window_err(bare, ref):.1f}'
        print(msg)
        if out:
            out.mkdir(parents=True, exist_ok=True)
            diff = np.zeros_like(ref)
            diff[..., 3] = 255
            diff[~same & area] = (255, 0, 255, 255)
            Image.fromarray(np.hstack([ours, ref, diff])).save(out / f'{name}.png')


if __name__ == '__main__':
    main()
