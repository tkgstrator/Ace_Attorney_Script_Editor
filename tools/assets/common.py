"""公式の画像アセットの計測で共通に使うもの（統計・色の数え方・ROM の読み込み）。

色は ROM の BGR555（15 ビット）のまま数える。PNG から数えるときは 8 ビットの値を 5 ビットに戻して数え、
戻せない値（c × 255 ÷ 31 の切り捨てでも、下画面の 6 ビットの変換でもない値）があれば 15 ビット色ではないとする。
"""
from __future__ import annotations

import re
import sys
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'tools/rom'))

import nds  # noqa: E402
from game_assets import Assets, assets_of  # noqa: E402

#: ゲームの短い名前 → (ROM のファイル名, 抽出物の置き場所)
GAMES = {
    'aa1': ('GYAKUTEN_YOM_AGYJ08_00.nds', ROOT / 'assets/extracted'),
    'aa2': ('GYAKUTEN_2_A2GJ08_00.nds', ROOT / 'assets/extracted/aa2'),
    'aa3': ('GYAKUTEN_3_YG3J08_00.nds', ROOT / 'assets/extracted/aa3'),
}
ROMS = ROOT / 'assets/roms'

#: 8 ビット → 5 ビット（上画面の書き出し c × 255 // 31 と、下画面の 6 ビットの変換の両方）
_TO5: dict[int, int] = {}
for _v in range(32):
    _TO5[_v * 255 // 31] = _v
    _TO5.setdefault(round((2 * _v + (_v > 0)) * 255 / 63), _v)


@dataclass
class Game:
    key: str
    rom: bytes
    arm9: bytes
    data: bytes
    A: Assets
    ext: Path


def load_game(key: str) -> Game:
    name, ext = GAMES[key]
    rom = (ROMS / name).read_bytes()
    files = {f.path: f for f in nds.list_files(rom)}
    f = files['data.bin']
    return Game(key, rom, nds.arm9(rom), rom[f.start:f.end], assets_of(rom), ext)


# ---- 統計 ----

def stats(values) -> dict | None:
    v = np.asarray([x for x in values if x is not None], float)
    if not len(v):
        return None
    q = np.percentile(v, [0, 10, 50, 90, 100])
    return {'n': int(len(v)), 'min': round(float(q[0]), 2), 'p10': round(float(q[1]), 2),
            'median': round(float(q[2]), 2), 'p90': round(float(q[3]), 2), 'max': round(float(q[4]), 2)}


def hist(values, top: int = 12) -> dict:
    """値 → 数（多い順に top 個まで。残りは other）"""
    c = Counter(values)
    out = {str(k): n for k, n in c.most_common(top)}
    rest = sum(c.values()) - sum(out.values())
    if rest:
        out['other'] = rest
    return out


def sizes(pairs) -> dict:
    """(幅, 高さ) の一覧 → 「幅x高さ」の分布"""
    return hist([f'{w}x{h}' for w, h in pairs])


def ratio(n: int, total: int) -> float | None:
    return round(n / total, 3) if total else None


# ---- 色 ----

def bgr555(b: bytes) -> list[int]:
    """パレットのバイト列 → 15 ビット色の一覧（最上位ビットは落とす）"""
    a = np.frombuffer(bytes(b[:len(b) // 2 * 2]), '<u2')
    return [int(x) & 0x7fff for x in a]


def indexed_colors(idx: np.ndarray, pal: list[int], transparent0: bool = True) -> dict:
    """色番号の絵とパレットから: 使う色番号の数・実際の色（15 ビット）の数・色 0 を使うか"""
    used = np.unique(idx)
    opaque = [int(i) for i in used if not (transparent0 and i == 0)]
    colors = {pal[i] for i in opaque if i < len(pal)}
    return {'indices': len(opaque), 'colors': len(colors), 'uses_index0': bool((idx == 0).any()),
            'max_index': int(idx.max(initial=0)), 'min_index': min(opaque, default=0)}


def rgba_of(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert('RGBA'))


def png_colors(path: Path) -> dict:
    """PNG の不透明な点の色の数・15 ビット色か・透明度の段・大きさ"""
    img = rgba_of(path)
    a = img[..., 3]
    px = img[a > 0][:, :3]
    uniq = np.unique(px, axis=0) if len(px) else np.zeros((0, 3), np.uint8)
    rgb5 = all(int(c) in _TO5 for c in np.unique(uniq)) if len(uniq) else True
    alphas = set(np.unique(a).tolist())
    return {'w': img.shape[1], 'h': img.shape[0], 'colors': len(uniq), 'rgb15': rgb5,
            'alpha_binary': alphas <= {0, 255}, 'has_transparent': 0 in alphas,
            'opaque_ratio': round(float((a > 0).mean()), 3)}


def png_index_info(path: Path) -> dict | None:
    """色番号の PNG（mode P）なら: パレットの長さ・使う色番号の数・色 0 を使うか"""
    im = Image.open(path)
    if im.mode != 'P':
        return None
    idx = np.asarray(im)
    pal = im.getpalette() or []
    return {'palette_len': len(pal) // 3, 'max_index': int(idx.max()),
            'indices_used': int(len(np.unique(idx))), 'uses_index0': bool((idx == 0).any())}


def bbox(alpha: np.ndarray) -> tuple[int, int, int, int] | None:
    ys, xs = np.nonzero(alpha)
    if not len(xs):
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def summarize_colors(rows: list[dict]) -> dict:
    """png_colors の結果の一覧 → 色の数の分布と、15 ビット色・透明の割合"""
    n = len(rows)
    return {
        'count': n,
        'size': sizes((r['w'], r['h']) for r in rows),
        'colors': stats(r['colors'] for r in rows),
        'colors_le15': ratio(sum(r['colors'] <= 15 for r in rows), n),
        'rgb15': ratio(sum(r['rgb15'] for r in rows), n),
        'alpha_binary': ratio(sum(r['alpha_binary'] for r in rows), n),
        'has_transparent': ratio(sum(r['has_transparent'] for r in rows), n),
    }


def script_counts(ext: Path, op: str) -> Counter:
    """台本（script/*.txt）の [op n ...] の n ごとの回数"""
    c: Counter = Counter()
    pat = re.compile(rf'\[{op} (\d+)')
    for f in sorted((ext / 'script').glob('*.txt')):
        c.update(int(m) for m in pat.findall(f.read_text(encoding='utf-8')))
    return c
