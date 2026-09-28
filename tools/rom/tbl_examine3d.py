# /// script
# requires-python = ">=3.11"
# dependencies = ["capstone>=5"]
# ///
"""「3D で詳しく調べる」（DS 版の第 5 話）の表を ARM9 から取り出して JSON にする。ROM は読むだけ。

    uv run tools/rom/tbl_examine3d.py <rom.nds> [出力（assets/extracted/tables/examine3d.json）]

■ 流れ（コードで確認）
  1. 法廷記録で証拠品を選んで「詳しく調べる」→ 3D の物 = 法廷記録の表 0x020ab27c の +0xc（model3d）− 1
     （0x0209009c / 0x02092378 → 0x02067bd4 で 0x02316250 に入れる）。
  2. 物の表 0x020b93d8（0x1c バイト × 66）: +0/+4 テクスチャの名前、+8 結果の番号の一覧へのポインター（u32 × +0xc 個）、
     +0x10 さえぎる面の数、+0x14 調べられる面（0x40 バイト × +0xc 個）、+0x18 さえぎる面（0x40 バイト × +0x10 個）。
     面 = u32 種類 + f32 × 15（向き 3 + 頂点 4 × xyz）。0x0203cc20 → 0x0203cd14 で、面を画面に写してカーソル
     （16×16）が中にあるか調べ、さえぎる面に当たれば外れ、調べられる面 i に当たれば 0x02313278 = i。
  3. 「調べる」ボタン → 結果の番号 = 一覧[i]（0x0203ece8）→ 結果の関数 0x020c0704[番号]（0x0206791c）。
     関数は区画（0x023162dc）・次に見せる物（0x02316250）・物の向きを決め、多くは台本の項目 070 を読み込む。
     区画が 0 でなければ、物の動きが終わった後にその区画を走らせる（0x0208cb44 / 0x0208cc74）。
     070 を読み込まない関数の区画は、今の話の台本（パートの項目）の区画。
  4. 070 の区画の最後は 116 5（下画面を 3D の画面に戻す）+ 21。閉じると話の台本を読み直す（0x0208d154）。
■ ルミノール（探偵パートで試薬を吹きかけて血の反応を探す遊び、0x020c96c0 の段の関数の表）: 今の背景（0x020ce300+0xc）を
  表 0x020c99b4（12 バイト × 10: u32 背景, ...）で引いた最初の番号 i（背景を横にずらしているとき（+0x1c = 0x80 / 0x100）は i + 1）
  → 0x020c0d08 の指す表（16 バイト × 12: u32 数, ?, ?, 行へのポインター）の i 番。行 = 0x28 バイト: +4 x, +8 y, +0xc 幅, +0x10 高さ
  （画面の座標）、+0x18 フラグ（組 0）、+0x1c 区画（+128、項目 070）。見つけるとフラグを立てる（0x0208168c）。
■ 話の台本から 3D の画面を開く所（116 8 46 = 下画面の状態 0x2e）は、開いたときの区画でモード（0x020d3974+0xe9d）が決まり、
  モードごとの決まった区画がコードに直接書かれている（STORY_MODES。番地の命令を読んで確かめる）。
"""
import json
import os
import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from arm9 import Arm9  # noqa: E402
from tbl_examine3d_sym import run  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OBJECTS, N_OBJECTS, OBJ_SIZE = 0x020b93d8, 66, 0x1c
RESULT_INIT, RESULT_FRAME, N_RESULTS = 0x020c0704, 0x020c07a8, 40
RECORD, N_RECORD, RECORD_SIZE = 0x020ab27c, 209, 0x18  # 208 = 携帯電話の一時の項目（036 §121 で加える）
LUMINOL_BG, N_LUMINOL_BG, LUMINOL_PTR, N_LUMINOL = 0x020c99b4, 10, 0x020c0d08, 12
EP5_PARTS = range(17, 35)  # 第 5 話のパート（項目 034〜068）
ITEM_070 = 0xffff  # 0x02023960(0xffff) = 項目 070 を読み込む

#: 話の台本から開いたときのモードと、モードごとの決まった区画（番地, 命令の形）。値は命令から読む
STORY_MODES = [
    {'mode': 0x0a, 'about': '携帯電話（開いた区画 §121 のとき）',
     'opened_at': (0x0205106c, r'cmp r0, #'), 'mode_at': (0x02051070, r'moveq r0, #'),
     'events': [
         {'on': 'close_with_flag', 'flag': (0x0208cfb8, r'mov r0, #'),
          'section': (0x0208d00c, r'mov r0, #'), 'about': '閉じたとき、フラグ（組 0。番号も同じ値 mov r1, r0）が立っていれば'},
         {'on': 'back', 'section': (0x0208d810, r'mov r0, #'), 'about': '見つける前に「もどる」を押したとき（0x0208c918 → 段 5 の 5〜7）'},
     ]},
    {'mode': 0x01, 'about': '説明（開いた区画 §63 のとき。財布）',
     'opened_at': (0x0205107c, r'cmp r0, #'), 'mode_at': (0x02051080, r'moveq r0, #'),
     'events': [
         {'on': 'open', 'section': (0x0208d538, r'mov r0, #'), 'about': '物を出し終えたとき'},
         {'on': 'hover', 'section': (0x0208d694, r'mov r0, #'), 'about': 'カーソルが調べられる面に初めて乗ったとき（0x0208c874）'},
         {'on': 'close', 'mode': 2, 'section': (0x0208cf60, r'mov r0, #'), 'about': '結果を見た後（モード 2）に閉じたとき'},
     ]},
    {'mode': 0x14, 'about': '開いた区画 §1 のとき（項目 042 の証拠品 196）',
     'opened_at': (0x02053218, r'cmp r0, #'), 'mode_at': (0x0205321c, r'moveq r0, #'),
     'events': [
         {'on': 'close', 'section': (0x0208d078, r'mov r0, #'), 'about': '閉じたとき'},
         {'on': 'auto_close', 'flag': (0x0208d340, r'mov r1, #'), 'about': '台詞の後、このフラグ（組 0）が立っていれば自動で閉じる'},
     ]},
    {'mode': 'luminol_tutorial', 'about': 'ルミノールの説明（116 6 0 → 説明の区画 → 116 6 1 → 反応を見つけた後、044 §18〜）。段の関数の表 0x020c96c0',
     'events': [{'on': 'open', 'section': (0x02080cd8, r'mov r0, #'), 'about': '116 6 0 で画面を開いたときの説明の区画（段 7 = 0x02080c50）'},
                {'on': 'found', 'section': (0x02082774, r'mov r0, #'), 'about': '反応の区画（と続く区画）の後に飛ぶ区画'}]},
    {'mode': 'e9e', 'about': '116 11（法廷でつきつける画面から調べる）で物 0x1b（証拠品 198）を調べ終えたとき',
     'object': (0x0208d0c8, r'cmp r0, #'),
     'events': [{'on': 'close', 'section': (0x0208d0f8, r'mov r0, #'), 'about': '閉じたとき（0x0208d0b4）'}]},
]


def imm(a9: Arm9, addr: int, pat: str) -> int:
    """番地の命令が pat（'mov r0, #' など）の形であることを確かめて、即値を返す"""
    line = a9.disasm(addr, 1)[0]
    m = re.search(re.escape(pat).replace(r'\ ', r'\s+') + r'(0x[0-9a-f]+|\d+)$', line)
    if not m:
        raise SystemExit(f'想定と違う命令です: {line}（{pat}）')
    return int(m.group(1), 0)


def sec(raw: int | None, item070: bool) -> dict | None:
    if not raw:
        return None
    return {'raw': raw, 'script': '070' if item070 else 'story', 'section': raw - 0x80}


def faces(a9: Arm9, ptr: int, n: int) -> list[dict]:
    out = []
    for i in range(n if ptr else 0):
        raw = a9.read(ptr + i * 0x40, 0x40)
        kind = struct.unpack_from('<I', raw)[0]
        f = [round(x, 3) for x in struct.unpack_from('<15f', raw, 4)]
        out.append({'kind': kind, 'normal': f[:3], 'points': [f[3 + 3 * k:6 + 3 * k] for k in range(4)]})
    return out


def objects(a9: Arm9, evidence: dict[int, int]) -> list[dict]:
    out = []
    for k in range(N_OBJECTS):
        w = struct.unpack('<7I', a9.read(OBJECTS + k * OBJ_SIZE, OBJ_SIZE))
        results = [a9.u32(w[2] + 4 * i) for i in range(w[3])] if w[2] else []
        spots = faces(a9, w[5], len(results))
        for i, s in enumerate(spots):
            s['result'] = results[i]
        out.append({
            'id': k, 'textures': [a9.cstr(p, 'latin1') for p in w[:2] if p],
            'evidence': sorted(e for e, o in evidence.items() if o == k),
            'spots': spots, 'blockers': faces(a9, w[6], w[4]),
        })
    return out


def result_paths(a9: Arm9, func: int) -> list[dict]:
    """パートごとに記号的に実行し、同じ結果になるパートをまとめる"""
    merged: dict[str, dict] = {}
    for part in EP5_PARTS:
        for p in run(a9, func, part):
            acts = p['acts']
            stores = {n: v for (a, n, v, *_) in (x for x in acts if x[0] == 'store')}
            item070 = any(a[0] == 'load_part' and a[1] == ITEM_070 for a in acts)
            path = {
                'when': {f'{g}:{n}': v for (g, n), v in (c for c in p['cond'] if isinstance(c[0], tuple))},
                'set_flags': {f'{a[1]}:{a[2]}': a[3] for a in acts if a[0] == 'set_flag'},
                'section': sec(stores.get('section'), item070),
                'next_object': stores['object'] if stores.get('object') is not None
                else ('+1' if 'object' in stores else None),
            }
            if any(a[0] in ('bad', 'too_long', 'unknown_switch') for a in acts):
                path['unsure'] = True
            key = json.dumps(path, sort_keys=True)
            merged.setdefault(key, {'parts': [], **path})['parts'].append(part)
    return list(merged.values())


def results(a9: Arm9) -> list[dict]:
    out = []
    for k in range(N_RESULTS):
        func = a9.u32(RESULT_INIT + 4 * k)
        loads = sorted({a[1] for p in run(a9, func, EP5_PARTS[0]) for a in p['acts'] if a[0] == 'load_object'})
        out.append({'id': k, 'func': hex(func), 'frame': hex(a9.u32(RESULT_FRAME + 4 * k)),
                    'load_objects': loads, 'paths': result_paths(a9, func)})
    return out


def luminol(a9: Arm9) -> list[dict]:
    """背景ごとのルミノールの反応の場所（ずらしていない見え方と、ずらした見え方）"""
    table = a9.u32(LUMINOL_PTR)
    out = []
    bgs = [a9.u32(LUMINOL_BG + i * 12) for i in range(N_LUMINOL_BG)]
    for bg in dict.fromkeys(b for b in bgs if b < 0x1000):
        i = bgs.index(bg)
        for scrolled, k in ((False, i), (True, i + 1)):
            if scrolled and (k >= N_LUMINOL_BG or bgs[k] != bg):
                continue  # ずらしても同じ背景の番号が続かなければ、ずらした見え方は無い
            n, _a, _b, recs = struct.unpack('<4I', a9.read(table + k * 16, 16))
            spots = []
            for r in range(n if recs else 0):
                w = struct.unpack('<10I', a9.read(recs + r * 0x28, 0x28))
                spots.append({'x': w[1], 'y': w[2], 'w': w[3], 'h': w[4], 'flag': w[6], 'section': sec(w[7], True)})
            if spots:
                out.append({'index': k, 'bg': bg, 'scrolled': scrolled, 'spots': spots})
    return out


def story_modes(a9: Arm9) -> list[dict]:
    out = []
    for m in STORY_MODES:
        d: dict = {'about': m['about']}
        if 'opened_at' in m:
            raw = imm(a9, *m['opened_at'])
            d['opened_at'] = {'raw': raw, 'section': raw - 0x80}
            d['mode'] = imm(a9, *m['mode_at'])
        else:
            d['mode'] = m['mode']
            if 'object' in m:
                d['object'] = imm(a9, *m['object'])
        d['events'] = []
        for e in m['events']:
            ev = {'on': e['on'], 'about': e['about']}
            if 'mode' in e:
                ev['mode'] = e['mode']
            if 'section' in e:
                raw = imm(a9, *e['section'])
                ev['section'] = {'raw': raw, 'section': raw - 0x80, 'code': hex(e['section'][0])}
            if 'flag' in e:
                ev['flag'] = f'0:{imm(a9, *e["flag"])}'
            d['events'].append(ev)
        out.append(d)
    return out


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    a9 = Arm9(open(sys.argv[1], 'rb').read())
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / 'assets/extracted/tables/examine3d.json'
    evidence = {e: a9.u16(RECORD + e * RECORD_SIZE + 0xc) - 1 for e in range(N_RECORD)}
    evidence = {e: o for e, o in evidence.items() if o >= 0}
    doc = {
        '_about': '「3D で詳しく調べる」（第 5 話）。tools/rom/tbl_examine3d.py の先頭の説明を参照。'
                  'objects[物].spots[面].result = 結果の番号 → results[番号].paths（パートとフラグの条件ごと）の section を走らせる。'
                  'section.script = 070（項目 070 の区画）/ story（今のパートの話の台本の区画）。next_object = 続けて見せる物（+1 = 今の物の次）。'
                  'luminol = 背景ごとのルミノールの反応の場所（x, y, 幅, 高さは画面の座標。scrolled = 横長の背景をずらした見え方）',
        'evidence': {str(e): o for e, o in sorted(evidence.items())},
        'objects': objects(a9, evidence),
        'results': results(a9),
        'story_modes': story_modes(a9),
        'luminol': luminol(a9),
    }
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    n = sum(len(o['spots']) for o in doc['objects'])
    print(f'{out}: 物 {len(doc["objects"])}、調べられる面 {n}、結果 {len(doc["results"])}、話の台本のモード {len(doc["story_modes"])}、'
          f'ルミノールの見え方 {len(doc["luminol"])}')


if __name__ == '__main__':
    main()
