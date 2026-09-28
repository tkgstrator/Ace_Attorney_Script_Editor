# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy"]
# ///
"""背景の描き方（普通 / 横長 / 縦長のスクロール、29 bg_effect、26 のパン、27 bg の読み込み待ち）と
第 1 話の 47 anim の書き出し。

    uv run tools/rom/tbl_bg_render.py <rom.nds> [出力先（既定: assets/extracted）]

書き出すもの:
    tables/bg_render.json              背景の種類・一覧・スクロール・パン（1 フレームずつ）・第 1 話の 47 anim
    data/tail/bg_fixed/<位置>_<W>x<H>.png   正しい形にした縦長 / 384 幅の背景（元の data/tail/bg/ はそのまま）
    data/tail/bg_fixed/court_pan_21f2f00_{648,1296}x192.png   法廷のパンの絵（半分 / 左右反転でつないだ全体）
    data/tail/bg_fixed/index.tsv       台本の背景の番号 → 正しい画像

ARM9 から読み取ったこと（説明は tables/bg_render.md）:
  背景の表 0x020a7cb4（16 バイト × 241: u32 data.bin の位置, u32 大きさ, u32 フラグ, u32 英語の差し替え（0x8000 = 無し））。
  フラグ: 0x80000000 = 4bpp（16 色）、下位 4 ビット = 絵の形（1 = 幅 512、2 = 幅 384、4 = 高さ 384、0 = 256×192）、
  0x10 / 0x20 = 横長の最初の位置（右端 / 左端）、0x40 / 0x80 = 縦長の最初の位置（下端 / 上端）。
  帯 6 本（8×8 タイル並び）は、幅 512 / 384 のときだけ 1 本が W×32、高さ 384 のときは 256×64（今までの書き出しは
  高さ 384 の絵を 512×32 と読んでいた → 左右の半分に偶数 / 奇数のタイル行が分かれて「同じ絵が 2 つ」に見えていた）。
"""
import json
import re
import struct
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bg_pan  # noqa: E402
import gfx  # noqa: E402
import nds  # noqa: E402
from databin import read_pack  # noqa: E402
from ex_tail import _unpack  # noqa: E402

B = 0x02000000
BG_TABLE, BG_COUNT = 0x020a7cb4, 241
EP1_SCRIPT = 'script/000.txt'


def load(rom_path: str):
    rom = Path(rom_path).read_bytes()
    f = next(f for f in nds.list_files(rom) if f.path == 'data.bin')
    return nds.arm9(rom), rom[f.start:f.end]


def shape(flags: int) -> dict:
    """フラグ → 絵の形と最初の位置（0x0201d3d8 / 0x0201c88c）"""
    bpp = 4 if flags & 0x80000000 else 8
    f = flags & 0xf
    if f == 0:
        return {'kind': 'static', 'w': 256, 'h': 192, 'bpp': bpp, 'start': [0, 0]}
    if f & 0xc:        # 縦長（0x8 は表に無い。0x0201cccc の 0xc780 バイトの読み込みから高さ 288? と推測）
        h = 384 if f & 4 else 288
        return {'kind': 'tall', 'w': 256, 'h': h, 'bpp': bpp, 'start': [0, h - 192 if flags & 0x40 else 0],
                'start_edge': 'bottom' if flags & 0x40 else 'top'}
    w = 512 if f & 1 else 384
    return {'kind': 'wide', 'w': w, 'h': 192, 'bpp': bpp, 'start': [w - 256 if flags & 0x10 else 0, 0],
            'start_edge': 'right' if flags & 0x10 else 'left'}


def extra_bits(flags: int) -> list[str]:
    notes = []
    if flags & 0x4000000:
        notes.append('0x4000000: 2 枚目の層（0x020ce34c、BG2）も一緒に縦に流す。y <= 192 で game+0x62/0x71 に印（詳細不明）')
    if flags & 0x2000000:
        notes.append('0x2000000: 自動で流れ続ける（BG2 の x を毎フレーム ±1（背景 74 は +1、ほかは -1）mod 512、'
                     'BG3 の y = 8 + 経過フレーム // 40）。bg_effect とは別（確かさ 低）')
    if flags & 0x1000000:
        notes.append('0x1000000: 意味不明（背景 66 = 集中線の絵）')
    return notes


def bg_rows(a: bytes, d: bytes, root: Path) -> list[dict]:
    old = {}
    tsv = root / 'script/bg_map.tsv'
    if tsv.exists():
        for line in tsv.read_text().splitlines()[1:]:
            c = line.split('\t')
            old[int(c[0])] = c[5]
    rows = []
    for i in range(BG_COUNT):
        off, size, flags, en = struct.unpack_from('<4I', a, BG_TABLE - B + i * 16)
        s = shape(flags)
        row = {'id': i, 'data_bin': hex(off), 'flags': hex(flags), 'en_alt': None if en == 0x8000 else en, **s,
               'png': f"data/tail/bg/{old.get(i, '-')}" if old.get(i, '-') != '-' else None}
        if s['kind'] == 'tall' or (s['kind'] == 'wide' and s['w'] == 384) or row['png'] is None:
            row['png_fixed'] = f"data/tail/bg_fixed/{off:07x}_{s['w']}x{s['h']}.png"
        if extra_bits(flags):
            row['notes'] = extra_bits(flags)
        rows.append(row)
    return rows


def export_bg(d: bytes, off: int, s: dict, path: Path) -> bool:
    ents, _ = read_pack(d, off) or (None, None) if off else (None, None)
    if not ents or len(ents) != 7:
        return False
    parts = [_unpack(d, p, n)[0] for p, n in ents]
    rows_per = len(parts[1]) * 8 // s['bpp'] // s['w']      # 1 本の帯の高さ（32 / 64）
    strips = [gfx.decode(b, s['w'], rows_per, s['bpp'], 'tiled') for b in parts[1:]]
    img = np.vstack(strips)
    if img.shape != (s['h'], s['w']):
        return False
    gfx.write_png(path, img, gfx.palette(parts[0]))
    return True


def export_pan(d: bytes, out: Path) -> None:
    p, n = bg_pan.PAN_IMAGE
    b = d[p:p + n]
    pal = gfx.palette(b[:32])
    img = gfx.decode(b[32:], bg_pan.TILES_W * 8, bg_pan.TILES_H * 8, 4, 'tiled')
    gfx.write_png(out / 'court_pan_21f2f00_648x192.png', img, pal)
    cols = [img[:, v * 8:v * 8 + 8] if v < 81 else img[:, (161 - v) * 8:(162 - v) * 8][:, ::-1] for v in range(162)]
    gfx.write_png(out / 'court_pan_21f2f00_1296x192.png', np.hstack(cols), pal)


def ep1_anims(root: Path) -> dict:
    """第 1 話（項目 000）で使う 47 anim の番号と、anims47.json から描き方をまとめる"""
    text = (root / EP1_SCRIPT).read_text()
    used: dict[int, dict] = {}
    for n, v in re.findall(r'\[anim (\d+) (\d+)\]', text):
        used.setdefault(int(n), {'on': 0, 'off': 0})['on' if v != '0' else 'off'] += 1
    table = {x['id']: x for x in json.loads((root / 'tables/anims47.json').read_text())['anims']}
    out = {}
    for n in sorted(used):
        e = table[n]
        ox, oy = e['origin_in_image'][0]
        img = root / e['image_dir'] / 'f00.png'
        w, h = struct.unpack('>II', img.read_bytes()[16:24]) if img.exists() else (None, None)
        out[str(n)] = {
            'label': e['label'], 'uses_on': used[n]['on'], 'uses_off': used[n]['off'],
            'frames_dir': e['image_dir'], 'frame_size': [w, h], 'origin_in_image': [ox, oy],
            'screen_origin': [e['x'], e['y']], 'top_left': [e['x'] - ox, e['y'] - oy],
            'steps': [{'png': f'f{k:02}.png', 'frames': st['frames'], **({'se': st['se']} if st.get('se') else {})}
                      for k, st in enumerate(e['steps'])],
            'total_frames': e['total_frames'], 'end': e['end'],
            'obj_priority': e['h0e'] >> 4, 'obj_palette': e['b0c'],
            'hflip': bool(int(e['flags'], 16) & 1),
            'auto_delete': ('前の背景（0x020ce300+0x10）が作ったときの背景と違ったら消える（144〜183）' if 144 <= n <= 183
                            else '今の背景が作ったときの背景と違ったら消える（60〜183）' if n >= 60 else
                            '背景に結び付かない'),
        }
    return out


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    a, d = load(sys.argv[1])
    root = Path(sys.argv[2] if len(sys.argv) > 2 else Path(__file__).resolve().parents[2] / 'assets/extracted')
    fixed = root / 'data/tail/bg_fixed'
    fixed.mkdir(parents=True, exist_ok=True)
    rows = bg_rows(a, d, root)
    index = ['背景の番号\tフラグ\t形\t正しい画像\t元の画像']
    done: set[str] = set()
    for r in rows:
        if 'png_fixed' not in r:
            continue
        name = r['png_fixed'].split('/')[-1]
        if name not in done:
            if not export_bg(d, int(r['data_bin'], 16), r, fixed / name):
                del r['png_fixed']
                continue
            done.add(name)
        index.append(f"{r['id']}\t{r['flags']}\t{r['kind']} {r['w']}x{r['h']} {r['bpp']}bpp\t{name}\t{r['png'] or '-'}")
    export_pan(d, fixed)
    (fixed / 'index.tsv').write_text('\n'.join(index) + '\n')
    spec = json.loads((Path(__file__).resolve().parent / 'data/bg_render_rules.json').read_text())
    spec['backgrounds'] = rows
    spec['pan'] = bg_pan.spec(a)
    spec['anims47_ep1'] = ep1_anims(root)
    (root / 'tables/bg_render.json').write_text(json.dumps(spec, ensure_ascii=False, indent=1) + '\n')
    print(f'背景 {len(rows)} 個（直した画像 {len(done)} 枚）、パン 6 種類、第 1 話の 47 anim {len(spec["anims47_ep1"])} 個')


if __name__ == '__main__':
    main()
