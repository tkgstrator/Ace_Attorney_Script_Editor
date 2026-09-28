"""DS 版（蘇る逆転・2・3）の人物のコマを測り、立ち絵の仕様（tools/sprites/SPEC.md）の数値の根拠を作る。

    uv run python tools/sprites/measure_official.py [--json tools/sprites/official-stats.json]

入力（手元だけにあり、配布しない）:
  assets/extracted/tables/char_anims.json と data/tail/chars/by_anim/NNN/fNN.png（蘇る逆転）
  assets/extracted/aa2|aa3/ の下の同じ名前のもの（2・3）
出力: 統計（中央値・範囲）だけを表示し、--json があれば JSON にも書く（書いたあと biome format --write で整える）。
      絵・名前・台詞は含まない。
"""
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
GAMES = {'aa1': 'assets/extracted', 'aa2': 'assets/extracted/aa2', 'aa3': 'assets/extracted/aa3'}
CENTER = (128, 96)
#: 差分が人物の不透明な点のこの割合より少なければ「部分差分」（口・目）とみなす
LOCAL = 0.05
#: まばたきのコマとみなす長さ（1/60 秒）の上限。口パクのコマはこれより長い
BLINK_MAX_DUR = 4
#: 待機（止まっている）とみなすコマの長さの下限
HOLD_MIN_DUR = 40
#: DS の 5 ビットの色の段（取り出した PNG は c * 255 // 31 で 8 ビットにしてある）
RGB5 = {c * 255 // 31 for c in range(32)}


def stats(values) -> dict | None:
    v = np.asarray([x for x in values if x is not None], float)
    if not len(v):
        return None
    q = np.percentile(v, [0, 10, 50, 90, 100])
    return {'n': int(len(v)), 'min': round(q[0], 3), 'p10': round(q[1], 3), 'median': round(q[2], 3),
            'p90': round(q[3], 3), 'max': round(q[4], 3)}


def load(path: Path) -> np.ndarray:
    return np.asarray(Image.open(path).convert('RGBA'))


def colors_of(img: np.ndarray) -> set[int]:
    """不透明な点の色（0xRRGGBB）の集合"""
    px = img[img[..., 3] > 0][:, :3].astype(np.uint32)
    return set(np.unique((px[:, 0] << 16) | (px[:, 1] << 8) | px[:, 2]).tolist())


def lum(c: int) -> float:
    return 0.299 * (c >> 16) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)


def neighbors_same(key: np.ndarray) -> np.ndarray:
    """上下左右のどれかに同じ色（キー）の点がある点"""
    same = np.zeros(key.shape, bool)
    same[1:] |= key[1:] == key[:-1]
    same[:-1] |= key[:-1] == key[1:]
    same[:, 1:] |= key[:, 1:] == key[:, :-1]
    same[:, :-1] |= key[:, :-1] == key[:, 1:]
    return same


def sat(c: int) -> float:
    ch = [(c >> 16) & 255, (c >> 8) & 255, c & 255]
    return (max(ch) - min(ch)) / max(ch) if max(ch) else 0.0


def between(img: np.ndarray) -> np.ndarray:
    """左右（または上下）の点の色のあいだの色になっている点（アンチエイリアスの疑い）"""
    rgb = img[..., :3].astype(np.int16)
    op = img[..., 3] > 0
    out = np.zeros(op.shape, bool)
    for a, c, b, sl in (
        (rgb[:, :-2], rgb[:, 1:-1], rgb[:, 2:], (slice(None), slice(1, -1))),
        (rgb[:-2], rgb[1:-1], rgb[2:], (slice(1, -1), slice(None))),
    ):
        o = op[sl] & (op[:, :-2] & op[:, 2:] if sl[0] == slice(None) else op[:-2] & op[2:])
        lo, hi = np.minimum(a, b), np.maximum(a, b)
        inside = np.all((c >= lo) & (c <= hi), axis=2)
        differ = np.any(a != b, axis=2) & np.any(c != a, axis=2) & np.any(c != b, axis=2)
        out[sl] |= o & inside & differ
    return out


def frame_metrics(img: np.ndarray) -> dict:
    a = img[..., 3]
    op = a > 0
    n = int(op.sum())
    key = (img[..., 0].astype(np.int64) << 24) | (img[..., 1].astype(np.int64) << 16) | \
          (img[..., 2].astype(np.int64) << 8) | a
    key = np.where(op, key, -1)
    pal = sorted(colors_of(img), key=lum)
    # 輪郭: 透明な点と上下左右で接する不透明な点
    pad = np.pad(op, 1)
    edge = op & ~(pad[:-2, 1:-1] & pad[2:, 1:-1] & pad[1:-1, :-2] & pad[1:-1, 2:])
    ek = img[edge][:, :3].astype(np.int64)
    ecol = (ek[:, 0] << 16) | (ek[:, 1] << 8) | ek[:, 2]
    rank = {c: i for i, c in enumerate(pal)}
    dark3 = float(np.mean([rank[int(c)] < 3 for c in ecol])) if len(ecol) else None
    top_edge = Counter(ecol.tolist()).most_common(1)
    # 輪郭の太さ: 外側の点から内側へ 1 点進んでも同じ色か（左右の外側の点で測る）
    thick = []
    h, w = op.shape
    for y in range(h):
        xs = np.nonzero(op[y])[0]
        if len(xs) < 4:
            continue
        for x, dx in ((xs[0], 1), (xs[-1], -1)):
            run = 0
            while 0 <= x + dx * run < w and key[y, x + dx * run] == key[y, x] and run < 6:
                run += 1
            thick.append(run)
    # 2×2 の市松（ディザ）
    k = key
    chk = (k[:-1, :-1] == k[1:, 1:]) & (k[:-1, 1:] == k[1:, :-1]) & (k[:-1, :-1] != k[:-1, 1:]) & \
          (k[:-1, :-1] >= 0) & (k[:-1, 1:] >= 0)
    ys, xs = np.nonzero(op)
    return {
        'opaque': n,
        'alpha_values': sorted(set(np.unique(a).tolist())),
        'colors': len(pal),
        'rgb555': all(((c >> s) & 255) in RGB5 for c in pal for s in (0, 8, 16)),
        'aa_suspect': float((between(img) & ~neighbors_same(key)).sum() / n) if n else None,
        'edge_top_black': top_edge[0][0] == 0 if top_edge else None,
        'edge_top_sat': sat(top_edge[0][0]) if top_edge else None,
        'isolated': float((op & ~neighbors_same(key)).sum() / n) if n else None,
        'checker': float(chk.sum() / n) if n else None,
        'edge_dark3': dark3,
        'edge_top_lum': lum(top_edge[0][0]) if top_edge else None,
        'edge_top_rank': rank[top_edge[0][0]] if top_edge else None,
        'thick': thick,
        'bbox': (int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())) if n else None,
        'palette': pal,
    }


def shade_steps(pal: list[int]) -> list[int]:
    """色相ごと（30 度の区切り、彩度・明度のある色だけ）の色の数 = 影の段数の目安"""
    groups = Counter()
    for c in pal:
        r, g, b = (c >> 16) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255
        mx, mn = max(r, g, b), min(r, g, b)
        if mx < 0.15 or (mx - mn) / mx < 0.15:
            continue
        if mx == r:
            hue = ((g - b) / (mx - mn)) % 6
        elif mx == g:
            hue = (b - r) / (mx - mn) + 2
        else:
            hue = (r - g) / (mx - mn) + 4
        groups[int(hue * 60 // 30)] += 1
    return [v for v in groups.values() if v >= 2]


def diff_region(base: np.ndarray, other: np.ndarray, bb) -> dict | None:
    if base.shape != other.shape:
        return None
    ch = np.any(base != other, axis=2)
    n = int(ch.sum())
    op = int((base[..., 3] > 0).sum())
    if n == 0 or not op:
        return {'changed': 0, 'frac': 0.0}
    ys, xs = np.nonzero(ch)
    x0, y0, x1, y1 = bb
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    return {
        'changed': n, 'frac': n / op,
        'w': int(xs.max() - xs.min() + 1), 'h': int(ys.max() - ys.min() + 1),
        'area_frac': (xs.max() - xs.min() + 1) * (ys.max() - ys.min() + 1) / (bw * bh),
        'density': n / ((xs.max() - xs.min() + 1) * (ys.max() - ys.min() + 1)),
        # 人物の不透明な範囲の中での位置（0 = 上端・左端、1 = 下端・右端）
        'cy': ((ys.min() + ys.max()) / 2 - y0) / bh, 'cx': ((xs.min() + xs.max()) / 2 - x0) / bw,
        'top_px': int(ys.min() - y0),
    }


def crop_hash(img: np.ndarray) -> str:
    """不透明な範囲だけを切り出した中身の要約（置き方の違う同じ絵を 1 つと数える）"""
    ys, xs = np.nonzero(img[..., 3] > 0)
    if not len(ys):
        return 'empty'
    return hashlib.sha1(np.ascontiguousarray(img[ys.min():ys.max() + 1, xs.min():xs.max() + 1]).tobytes()).hexdigest()


def measure_game(game: str, base: Path) -> dict:
    anims = json.loads((base / 'tables/char_anims.json').read_text())['anims']
    chars = json.loads((base / 'tables/chars.json').read_text())['chars']
    seen_frames: dict[str, dict] = {}
    seen_anims: dict[str, str] = {}
    out = {'anims': [], 'diffs': [], 'frames': [], 'by_aid': {}}
    anim_colors: dict[str, set[int]] = {}
    for aid, a in anims.items():
        d = base / a['png_dir']
        files = sorted(d.glob('f*.png'))
        if not files or not a['frames']:
            continue
        imgs = {int(f.stem[1:]): load(f) for f in files}
        h = hashlib.sha1(json.dumps([a['frames'], a['origin']]).encode())
        for i in sorted(imgs):
            h.update(imgs[i].tobytes())
        hk = h.hexdigest()
        cols = set()
        # 人物ごとの数え上げ用（measure_chars.py）: 使うコマの中身と、ファイル・台本での使用回数
        used = {f['frame'] for f in a['frames']}
        rec = {'file': a['file'], 'uses': a.get('script_uses', 0), 'frames': set()}
        out['by_aid'][aid] = rec
        for i, img in imgs.items():
            fk = hashlib.sha1(img.tobytes()).hexdigest()
            if i in used:
                rec['frames'].add(crop_hash(img))
            if fk not in seen_frames:
                m = frame_metrics(img)
                m['origin'], m['size'] = a['origin'], [img.shape[1], img.shape[0]]
                seen_frames[fk] = m
                out['frames'].append(m)
            cols |= set(seen_frames[fk]['palette'])
        anim_colors[aid] = rec['colors'] = cols
        if hk in seen_anims:
            rec['kind'] = seen_anims[hk]
            continue
        b0 = min(imgs)
        bm = seen_frames[hashlib.sha1(imgs[b0].tobytes()).hexdigest()]
        durs = {}
        for f in a['frames']:
            durs.setdefault(f['frame'], []).append(f['dur'])
        kinds = {}
        for i in imgs:
            if i == b0 or i not in durs or bm['bbox'] is None:
                continue
            dr = diff_region(imgs[b0], imgs[i], bm['bbox'])
            if dr is None or dr['changed'] == 0:
                continue
            local = dr['frac'] < LOCAL
            role = 'big' if not local else ('blink' if max(durs[i]) <= BLINK_MAX_DUR else 'mouth')
            kinds[i] = role
            out['diffs'].append({**dr, 'role': role, 'game': game})
        seq = [f['dur'] for f in a['frames']]
        roles = set(kinds.values())
        if 'big' in roles:
            kind = 'special'
        elif max(seq) >= HOLD_MIN_DUR:
            kind = 'idle'
        elif 'mouth' in roles:
            kind = 'talk'
        else:
            kind = 'other'
        seen_anims[hk] = rec['kind'] = kind
        out['anims'].append({
            'kind': kind, 'end': a['end'], 'n_frames': len(set(f['frame'] for f in a['frames'])),
            'seq_len': len(seq), 'total': sum(seq), 'durs': seq,
            'blink_durs': [d for i, r in kinds.items() if r == 'blink' for d in durs[i]],
            'mouth_frames': sum(1 for r in kinds.values() if r == 'mouth'),
            'mouth_durs': [d for i, r in kinds.items() if r == 'mouth' for d in durs[i]],
            'hold_durs': [d for d in seq if d >= HOLD_MIN_DUR],
            'size': a['size'], 'origin': a['origin'], 'bbox': bm['bbox'],
        })
    out['char_colors'] = []
    out['char_anims'] = []
    for c in chars.values():
        ids = [str(x) for x in c.get('anims', []) if str(x) in anim_colors]
        if ids:
            out['char_colors'].append(len(set().union(*(anim_colors[i] for i in ids))))
            out['char_anims'].append(len(ids))
    out['anim_colors'] = [len(v) for v in anim_colors.values()]
    return out


def summarize(all_: dict[str, dict]) -> dict:
    frames = [f for g in all_.values() for f in g['frames']]
    anims = [a for g in all_.values() for a in g['anims']]
    diffs = [d for g in all_.values() for d in g['diffs']]
    ox = [a['origin'][0] for a in anims]
    oy = [a['origin'][1] for a in anims]
    # 画面の座標での不透明な範囲（基準点を (128, 96) に置いたとき）
    scr = [(CENTER[0] - a['origin'][0] + a['bbox'][0], CENTER[1] - a['origin'][1] + a['bbox'][1],
            CENTER[0] - a['origin'][0] + a['bbox'][2], CENTER[1] - a['origin'][1] + a['bbox'][3])
           for a in anims if a['bbox'] and a['kind'] in ('idle', 'talk')]
    thick = Counter(t for f in frames for t in f['thick'])
    tot = sum(thick.values())
    by_kind = {}
    for k in ('idle', 'talk', 'special', 'other'):
        g = [a for a in anims if a['kind'] == k]
        by_kind[k] = {
            'count': len(g), 'end': dict(Counter(a['end'] for a in g)),
            'n_frames': stats(a['n_frames'] for a in g), 'seq_len': stats(a['seq_len'] for a in g),
            'total_dur': stats(a['total'] for a in g),
            'frame_dur': stats(d for a in g for d in a['durs']),
        }
    role = lambda r: [d for d in diffs if d['role'] == r]  # noqa: E731
    region = lambda ds: {k: stats(d[k] for d in ds) for k in  # noqa: E731
                         ('changed', 'frac', 'w', 'h', 'area_frac', 'density', 'cx', 'cy', 'top_px')}
    return {
        'unique_frames': len(frames), 'unique_anims': len(anims),
        'canvas': {'w': stats(f['size'][0] for f in frames), 'h': stats(f['size'][1] for f in frames),
                   'w_mod8': dict(Counter(f['size'][0] % 8 for f in frames)),
                   'h_mod8': dict(Counter(f['size'][1] % 8 for f in frames))},
        'origin': {'x': stats(ox), 'y': stats(oy), 'x_minus_half_w': stats(a['origin'][0] - a['size'][0] / 2 for a in anims)},
        'screen_bbox_idle_talk': {
            'left': stats(s[0] for s in scr), 'top': stats(s[1] for s in scr),
            'right': stats(s[2] for s in scr), 'bottom': stats(s[3] for s in scr),
            'width': stats(s[2] - s[0] + 1 for s in scr), 'height': stats(s[3] - s[1] + 1 for s in scr),
            'bottom_ge_191': sum(s[3] >= 191 for s in scr) / max(1, len(scr)),
        },
        'alpha': dict(Counter(tuple(f['alpha_values']) != (0, 255) and tuple(f['alpha_values']) != (255,) and tuple(f['alpha_values']) != (0,) for f in frames)),
        'colors_per_frame': stats(f['colors'] for f in frames),
        'frames_le_15_colors': sum(f['colors'] <= 15 for f in frames) / len(frames),
        'colors_per_anim': stats(c for g in all_.values() for c in g['anim_colors']),
        'colors_per_char': stats(c for g in all_.values() for c in g['char_colors']),
        'anims_per_char': stats(c for g in all_.values() for c in g['char_anims']),
        'rgb555_frames': sum(f['rgb555'] for f in frames) / len(frames),
        'isolated_px_frac': stats(f['isolated'] for f in frames),
        'aa_suspect_frac': stats(f['aa_suspect'] for f in frames),
        'checker_frac': stats(f['checker'] for f in frames),
        'outline': {
            'edge_in_darkest3': stats(f['edge_dark3'] for f in frames),
            'top_edge_color_rank': stats(f['edge_top_rank'] for f in frames),
            'top_edge_color_lum': stats(f['edge_top_lum'] for f in frames),
            'top_edge_color_sat': stats(f['edge_top_sat'] for f in frames),
            'top_edge_black_share': sum(bool(f['edge_top_black']) for f in frames) / len(frames),
            'run_len_share': {str(k): round(v / tot, 3) for k, v in sorted(thick.items())},
        },
        'shade_steps_per_hue': stats(s for f in frames for s in shade_steps(f['palette'])),
        'anim_kinds': by_kind,
        'blink': {'durs': stats(d for a in anims for d in a['blink_durs']),
                  'hold_between': stats(d for a in anims if a['kind'] == 'idle' for d in a['hold_durs']),
                  'region': region(role('blink'))},
        'mouth': {'frames_per_talk': stats(a['mouth_frames'] for a in anims if a['kind'] == 'talk'),
                  'durs': stats(d for a in anims for d in a['mouth_durs']),
                  'region': region(role('mouth'))},
        'big_diff': {'count': len(role('big')), 'frac': stats(d['frac'] for d in role('big'))},
    }


def main() -> None:
    args = sys.argv[1:]
    out_json = args[args.index('--json') + 1] if '--json' in args else None
    per = {}
    for game, rel in GAMES.items():
        base = ROOT / rel
        if (base / 'tables/char_anims.json').exists():
            per[game] = measure_game(game, base)
            print(f'{game}: 動き {len(per[game]["anims"])} / コマ {len(per[game]["frames"])}', file=sys.stderr)
    if not per:
        sys.exit('assets/extracted に取り出したデータがありません')
    result = {'_about': '公式の人物のコマの統計（数値のみ）。uv run python tools/sprites/measure_official.py で作り直せる',
              'games': list(per), 'all': summarize(per), 'per_game': {g: summarize({g: v}) for g, v in per.items()}}
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if out_json:
        Path(out_json).write_text(text + '\n')
    print(json.dumps(result['all'], ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
