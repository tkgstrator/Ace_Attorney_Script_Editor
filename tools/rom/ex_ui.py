# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "pillow"]
# ///
"""下画面（法廷記録・ボタンなど）の UI 部品の書き出しと、スクリーンショットでの確かめ。

    uv run tools/rom/ex_ui.py <rom.nds> [出力先（既定: assets/extracted/ui）] [--samples assets/samples/ds/bottom]

書き出すもの（出力先の中）:
    obj/NNN_<名前>.png      部品（日本語版）。インデックスカラー、色番号 0 が透明。パレットは ui_parts.py の既定
    obj_en/NNN_<名前>.png   英語版で絵が違う部品
    obj_alt/NNN_<名前>_<パレット>.png  ボタンを別のパレット（黄色 = 押した・選んだとき？ など）で描いたもの
    palettes.json           OBJ のパレット 33 個（BGR555 と、スクリーンショットと同じ 8 ビットの RGB）
    court_bg_sepia.png      下画面の暗い法廷の背景（推定。ui_bg.py）
    scenes/<場面>.png       確かめた置き場所に部品を並べたもの（透明の上）
    index.json              部品の一覧（名前・用途・大きさ・data.bin の位置・パレット・置き場所・一致率）
    _sheet.png              一覧画像

形式の説明は ui_obj.py、名前と置き場所は ui_parts.py、背景は ui_bg.py の先頭を参照。
スクリーンショットは ICC プロファイル付きだが、色の値はそのまま（変換せずに）比べる。
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import gfx  # noqa: E402
import ui_bg  # noqa: E402
import ui_obj  # noqa: E402
from nds import arm9, list_files  # noqa: E402
from ui_parts import P_BUTTON, P_BUTTON_ON, PARTS, PLACEMENTS  # noqa: E402

ALT_PALETTES = {'yellow': P_BUTTON_ON, 'beige': 0x2f512c8, 'gray': 0x2f512e8, 'dark': 0x2f51308}


def load_shots(samples: Path) -> dict[str, list[np.ndarray]]:
    shots: dict[str, list[np.ndarray]] = {}
    if not samples.is_dir():
        return shots
    for d in sorted(p for p in samples.iterdir() if p.is_dir()):
        shots[d.name] = [np.array(Image.open(f).convert('RGB')) for f in sorted(d.glob('*.png'))]
    return shots


def place(canvas: np.ndarray, rgba: np.ndarray, x: int, y: int) -> None:
    """RGBA の部品を 256×192 の RGBA に重ねる（画面の外は切る）"""
    h, w = rgba.shape[:2]
    ya, yb, xa, xb = max(0, -y), min(h, 192 - y), max(0, -x), min(w, 256 - x)
    if ya >= yb or xa >= xb:
        return
    src = rgba[ya:yb, xa:xb]
    dst = canvas[y + ya:y + yb, x + xa:x + xb]
    m = src[..., 3] > 0
    dst[m] = src[m]


def draw(rgba: np.ndarray, flags: str) -> np.ndarray:
    """描き方（'h' 左右反転 / 'v' 上下反転 / '2' 横 2 倍）を当てる"""
    if 'h' in flags:
        rgba = rgba[:, ::-1]
    if 'v' in flags:
        rgba = rgba[::-1]
    if '2' in flags:
        rgba = np.repeat(rgba, 2, axis=1)
    return rgba


def match(canvas: np.ndarray, owner: np.ndarray, shots: list[np.ndarray]) -> tuple[dict, dict]:
    """場面を並べた絵とスクリーンショットを比べる。UI が写っている（不透明な画素の半分以上が一致する）ものだけ数える
    （ボタンが出る前・画面の切り替えの途中のものは数えない）。
    返り値: 場面全体 {'seen', 'exact', 'min'}、部品ごと（手前に見えている画素だけ）{部品: 一致率の最小}"""
    m = canvas[..., 3] > 0
    total = {'seen': 0, 'exact': 0, 'min': 1.0}
    parts: dict[int, float] = {}
    for s in shots:
        ok = (s == canvas[..., :3]).all(2) & m
        r = ok.sum() / max(m.sum(), 1)
        if r <= 0.5:
            continue
        total['seen'] += 1
        total['exact'] += int(r >= 0.9999)
        total['min'] = min(total['min'], float(r))
        for i in np.unique(owner[m]):
            mi = owner == i
            parts[int(i)] = min(parts.get(int(i), 1.0), float((ok & mi).sum() / mi.sum()))
    return total, parts


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        sys.exit(__doc__)
    samples = Path('assets/samples/ds/bottom')
    if '--samples' in sys.argv:
        samples = Path(sys.argv[sys.argv.index('--samples') + 1])
        args = [a for a in args if a != str(samples)]
    rom = open(args[0], 'rb').read()
    out = Path(args[1]) if len(args) > 1 else Path('assets/extracted/ui')
    a = arm9(rom)
    f = next(x for x in list_files(rom) if x.path == 'data.bin')
    d = rom[f.start:f.end]
    shots = load_shots(samples)
    for sub in ('obj', 'obj_en', 'obj_alt', 'scenes'):
        (out / sub).mkdir(parents=True, exist_ok=True)

    pals = {o: ui_obj.palette(d, o) for o in
            [ui_obj.PAL_BASE + 0x20 * i for i in range(ui_obj.PAL_COUNT)] + [0x1ab0f94]}
    (out / 'palettes.json').write_text(json.dumps([
        {'offset': hex(o), 'bgr555': [int(v) for v in np.frombuffer(d[o:o + 32], '<u2')],
         'rgb': p.tolist()} for o, p in pals.items()], ensure_ascii=False, indent=1))

    index, rgbas, sheet = [], {}, []
    for r in ui_obj.records(a):
        i = r['index']
        name, purpose, pal_off, conf = PARTS[i]
        W, H, cols, rows, ow, oh = ui_obj.layout(a, r['group'])
        idx = ui_obj.render(a, d, r['group'], *r['ja'])
        pal = pals[pal_off]
        stem = f'{i:03d}_{name}'
        gfx.write_png(out / 'obj' / f'{stem}.png', idx, [tuple(c) for c in pal], transparent0=True)
        sheet.append(out / 'obj' / f'{stem}.png')
        rgbas[i] = ui_obj.rgba(idx, pal)
        ent = {'index': i, 'id': r['id'], 'name': name, 'purpose': purpose, 'file': f'obj/{stem}.png',
               'size': [W, H], 'obj': {'cols': cols, 'rows': rows, 'w': ow, 'h': oh},
               'data_ja': [hex(r['ja'][0]), r['ja'][1]], 'data_en': [hex(r['en'][0]), r['en'][1]],
               'palette': hex(pal_off), 'palette_confidence': conf, 'positions': []}
        if r['en'] != r['ja'] and d[r['en'][0]:r['en'][0] + r['en'][1]] != d[r['ja'][0]:r['ja'][0] + r['ja'][1]]:
            gfx.write_png(out / 'obj_en' / f'{stem}.png', ui_obj.render(a, d, r['group'], *r['en']),
                          [tuple(c) for c in pal], transparent0=True)
            ent['file_en'] = f'obj_en/{stem}.png'
        if pal_off == P_BUTTON:
            ent['file_alt'] = {}
            for key, po in ALT_PALETTES.items():
                p = f'obj_alt/{stem}_{key}.png'
                gfx.write_png(out / p, idx, [tuple(c) for c in pals[po]], transparent0=True)
                ent['file_alt'][key] = p
        index.append(ent)

    # 置き場所の確かめと、場面ごとの並べた絵
    scenes: dict[str, tuple[np.ndarray, np.ndarray]] = {}
    for scene, i, x, y, flags in PLACEMENTS:
        canvas, owner = scenes.setdefault(scene, (np.zeros((192, 256, 4), np.uint8), np.full((192, 256), -1)))
        img = draw(rgbas[i], flags)
        place(canvas, img, x, y)
        mark = np.zeros((192, 256, 4), np.uint8)
        place(mark, img, x, y)
        owner[mark[..., 3] > 0] = i
        index[i]['positions'].append({'scene': scene, 'x': x, 'y': y, 'draw': flags})
    print('場面\t写っている枚数 / 全画素一致の枚数 / 場面の枚数\t一致率の最小\t部品ごとの最小')
    checks = {}
    for scene, (canvas, owner) in scenes.items():
        gfx.write_rgba_png(out / 'scenes' / f'{scene}.png', canvas)
        total, parts = match(canvas, owner, shots.get(scene, []))
        checks[scene] = {**total, 'shots': len(shots.get(scene, [])), 'parts': parts}
        worst = ', '.join(f'{i}:{r:.3f}' for i, r in parts.items() if r < 0.9999) or 'すべて 1.000'
        print(f'{scene}\t{total["seen"]} / {total["exact"]} / {len(shots.get(scene, []))}\t{total["min"]:.4f}\t{worst}')

    bg = ui_bg.export(d, {k: v for k, v in shots.items() if k in ('advance', 'idle', 'cross-exam')}, out) \
        if shots else None
    if bg:
        print(f'court_bg_sepia.png（推定）: 見えている所の一致率 {bg["match"]:.3f}')
    (out / 'index.json').write_text(json.dumps({'parts': index, 'scenes': checks, 'court_bg': bg}, ensure_ascii=False, indent=1))
    gfx.contact_sheet(sheet, out / '_sheet.png', cols=8, cell=128, labels=[p.stem for p in sheet])
    print(f'{len(index)} 個の部品を {out} に書き出した')


if __name__ == '__main__':
    main()
