# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy"]
# ///
"""背景の描き方（普通 / 横長 / 縦長のスクロール、29 bg_effect、26 のパン、27 bg の読み込み待ち）と
第 1 話の 47 anim の書き出し。

    uv run tools/rom/tbl_bg_render.py <rom.nds> [出力先（既定: ゲームごとの置き場所。蘇る逆転 = assets/extracted）]

2・3（A2GJ / YG3J）では表の番号（台本の 27 の番号）のまま、全部の背景を正しい形で data/tail/bg/bgNNN_<位置>.png に
書き出し（png_fixed は作らない）、script/bg_map.tsv も書く（最後の列 = data/tail/bg/ のファイル名）。表の番地は game_assets.py。
パンの絵は data/tail/bg_fixed/court_pan_<位置>_*.png（番地は bg_pan.PAN_23）。第 1 話の 47 anim のまとめ（anims47_ep1）は作らない。

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
from game_assets import ASSETS, Assets, assets_of  # noqa: E402

B = 0x02000000
EP1_SCRIPT = 'script/000.txt'


def load(rom_path: str):
    rom = Path(rom_path).read_bytes()
    f = next(f for f in nds.list_files(rom) if f.path == 'data.bin')
    return nds.arm9(rom), rom[f.start:f.end], assets_of(rom)


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


def table_rows(a: bytes, A: Assets = ASSETS['AGYJ']) -> list[tuple[int, int, int, int]]:
    """背景の表の行 (data.bin の位置, 大きさ, フラグ, 英語の差し替え)"""
    return [struct.unpack_from('<4I', a, A.bg_table - B + i * 16) for i in range(A.bg_count)]


def bg_file_23(i: int, off: int, first: dict[int, int]) -> str:
    """2・3 の背景の書き出し先（同じ絵を指す行は最初の番号の名前にそろえる）"""
    return f'bg{first.setdefault(off, i):03}_{off:07x}.png'


def bg_rows(a: bytes, d: bytes, root: Path, A: Assets = ASSETS['AGYJ']) -> list[dict]:
    if A.code != 'AGYJ':
        return bg_rows_23(a, A)
    old = {}
    tsv = root / 'script/bg_map.tsv'
    if tsv.exists():
        for line in tsv.read_text().splitlines()[1:]:
            c = line.split('\t')
            old[int(c[0])] = c[5]
    rows = []
    for i, (off, size, flags, en) in enumerate(table_rows(a, A)):
        s = shape(flags)
        row = {'id': i, 'data_bin': hex(off), 'flags': hex(flags), 'en_alt': None if en == 0x8000 else en, **s,
               'png': f"data/tail/bg/{old.get(i, '-')}" if old.get(i, '-') != '-' else None}
        if s['kind'] == 'tall' or (s['kind'] == 'wide' and s['w'] == 384) or row['png'] is None:
            row['png_fixed'] = f"data/tail/bg_fixed/{off:07x}_{s['w']}x{s['h']}.png"
        if extra_bits(flags):
            row['notes'] = extra_bits(flags)
        rows.append(row)
    return rows


def bg_rows_23(a: bytes, A: Assets) -> list[dict]:
    rows, first = [], {}
    for i, (off, _size, flags, en) in enumerate(table_rows(a, A)):
        s = shape(flags)
        row = {'id': i, 'data_bin': hex(off), 'flags': hex(flags), 'en_alt': None if en == 0x8000 else en, **s,
               'png': f'data/tail/bg/{bg_file_23(i, off, first)}'}
        if extra_bits(flags):
            row['notes'] = extra_bits(flags)
        rows.append(row)
    return rows


def main_23(a: bytes, d: bytes, A: Assets, root: Path) -> None:
    """2・3: 表の背景を全部書き出し、bg_map.tsv と bg_render.json（パン・47 anim は未解明なので null）を書く"""
    bgdir = root / 'data/tail/bg'
    bgdir.mkdir(parents=True, exist_ok=True)
    rows = bg_rows(a, d, root, A)
    tsv = ['背景の番号\tdata.bin の位置\t大きさ\tフラグ\t種類\tファイル（data/tail/bg/）']
    done: dict[str, bool] = {}
    for r, (off, size, flags, en) in zip(rows, table_rows(a, A)):
        name = r['png'].split('/')[-1]
        if name not in done:
            done[name] = export_bg(d, off, r, bgdir / name)
        if not done[name]:
            r['png'] = None
        tsv.append(f"{r['id']}\t{off:#x}\t{size}\t{flags:#x}\t{en:#x}\t{name if done[name] else '-'}")
    (root / 'script').mkdir(parents=True, exist_ok=True)
    (root / 'script/bg_map.tsv').write_text('\n'.join(tsv) + '\n', encoding='utf-8')
    spec = json.loads((Path(__file__).resolve().parent / 'data/bg_render_rules.json').read_text())
    spec['_about'] += f'。{A.game.title}（{A.code}）: 背景の表 {A.bg_table:#010x}。規則（番地）は蘇る逆転で調べたもの'
    spec['backgrounds'] = rows
    spec['pan'] = bg_pan.spec_23(a, A.code)
    if spec['pan']:
        export_pan(d, root / 'data/tail/bg_fixed', bg_pan.PAN_23[A.code][0])
    (root / 'tables').mkdir(parents=True, exist_ok=True)
    (root / 'tables/bg_render.json').write_text(json.dumps(spec, ensure_ascii=False, indent=1) + '\n')
    print(f'背景 {len(rows)} 個（画像 {sum(done.values())} 枚、書き出せないもの {len(done) - sum(done.values())}）')


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


def export_pan(d: bytes, out: Path, pan: tuple = bg_pan.PAN_IMAGE) -> None:
    p, n = pan
    b = d[p:p + n]
    pal = gfx.palette(b[:32])
    img = gfx.decode(b[32:], bg_pan.TILES_W * 8, bg_pan.TILES_H * 8, 4, 'tiled')
    out.mkdir(parents=True, exist_ok=True)
    gfx.write_png(out / f'court_pan_{p:07x}_648x192.png', img, pal)
    cols = [img[:, v * 8:v * 8 + 8] if v < 81 else img[:, (161 - v) * 8:(162 - v) * 8][:, ::-1] for v in range(162)]
    gfx.write_png(out / f'court_pan_{p:07x}_1296x192.png', np.hstack(cols), pal)


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
    a, d, A = load(sys.argv[1])
    root = Path(sys.argv[2]) if len(sys.argv) > 2 else A.game.out
    if A.code != 'AGYJ':
        main_23(a, d, A, root)
        return
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
