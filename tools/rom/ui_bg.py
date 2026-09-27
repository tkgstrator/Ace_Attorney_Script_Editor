"""下画面の暗い法廷の背景（推定）。ex_ui.py から使う。

分かったこと:
- 下画面の法廷の背景は、上画面の法廷の全景（台本の背景 6、data.bin 0x1c478dc、8bpp 256×192）と
  同じ絵を、セピアの濃淡にして暗くし、4 行ごとに 1 行明るい横縞を重ねたもの。位置のずれは無い
  （背景 6 の色番号とスクリーンショットの色が画素単位でよく対応する）。
- ただし色は背景 6 の色番号だけでは決まらない（同じ番号でも 1 割ほど違う色になる）。セピアにする計算と縞の層は
  まだ ARM9 で見つけていない。

ここでは、スクリーンショットの UI が載っていない所から「(縞の行か, 色番号) → 色」の多数決の表を作り、
全面を塗って書き出す（見えない色番号は明るさの近い番号の色で埋める）。**推定であり、ROM から直接取った絵ではない。**
"""
import collections
from pathlib import Path

import numpy as np

import gfx
from databin import read_pack
from nitro import decompress

COURT_BG = 0x1c478dc   # 台本の背景 6（法廷の全景）


def court_indices(d: bytes) -> tuple[np.ndarray, np.ndarray]:
    """背景 6 の色番号（192×256）と 5 ビットの RGB パレット（256×3）"""
    ents, _ = read_pack(d, COURT_BG)
    p0, s0 = ents[0]
    c = np.frombuffer(d[p0:p0 + s0], '<u2').astype(int)
    pal = np.stack([c & 31, c >> 5 & 31, c >> 10 & 31], 1)
    strips = [gfx.decode(decompress(d, p)[0], 256, 32, 8) for p, _ in ents[1:]]
    return np.vstack(strips), pal


def _visible(scene: str) -> np.ndarray:
    """UI が載っていない（背景がそのまま見える）所"""
    m = np.zeros((192, 256), bool)
    if scene in ('advance', 'idle'):
        m[:, :] = True
        m[40:152, 14:242] = False
        m[0:34, 168:] = False
        m[176:] = False
    elif scene == 'cross-exam':
        m[34:176] = True
        m[60:152, 14:242] = False
    return m


def reconstruct(d: bytes, shots: dict[str, list[np.ndarray]]) -> tuple[np.ndarray, float]:
    """(再現した 192×256×3, 見えている所で色が一致した割合)"""
    idx, pal = court_indices(d)
    stripe = (np.arange(192) % 4 == 2)[:, None].repeat(256, 1)
    votes: dict[tuple[bool, int], collections.Counter] = collections.defaultdict(collections.Counter)
    for scene, imgs in shots.items():
        m = _visible(scene)
        for s in imgs:
            for y, x in zip(*np.nonzero(m)):
                votes[(bool(stripe[y, x]), int(idx[y, x]))][tuple(s[y, x])] += 1
    table = {k: np.array(c.most_common(1)[0][0]) for k, c in votes.items()}
    lum = pal @ np.array([3, 6, 1])
    out = np.zeros((192, 256, 3), np.uint8)
    for st in (False, True):
        seen = [i for (s, i) in table if s == st]
        for i in range(256):
            if (st, i) in table:
                col = table[(st, i)]
            elif seen:
                col = table[(st, min(seen, key=lambda j: abs(int(lum[j]) - int(lum[i]))))]
            else:
                continue
            out[(idx == i) & (stripe == st)] = col
    hit = tot = 0
    for scene, imgs in shots.items():
        m = _visible(scene)
        for s in imgs:
            hit += int(((s == out).all(2) & m).sum())
            tot += int(m.sum())
    return out, hit / max(tot, 1)


def export(d: bytes, shots: dict[str, list[np.ndarray]], out: Path) -> dict:
    img, ratio = reconstruct(d, shots)
    gfx.write_rgba_png(out / 'court_bg_sepia.png', np.dstack([img, np.full((192, 256), 255, np.uint8)]))
    return {'file': 'court_bg_sepia.png', 'size': [256, 192], 'position': [0, 0],
            'source': f'data.bin {COURT_BG:#x}（台本の背景 6）の色番号 + スクリーンショットから作った色の表（推定）',
            'match': round(ratio, 4)}
