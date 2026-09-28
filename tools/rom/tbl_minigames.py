# /// script
# requires-python = ">=3.11"
# dependencies = ["capstone>=5", "numpy", "pillow"]
# ///
"""DS 版の第 5 話だけの遊び（指紋・防犯カメラの映像・ツボの組み立て）の表を ARM9 から取り出して JSON にし、
映像の場面の絵を書き出す。ROM は読むだけ。

    uv run tools/rom/tbl_minigames.py <rom.nds> [出力先（既定 assets/extracted）]

書き出すもの: tables/minigames.json（指紋・人物の指名・映像・ツボ・金庫）、data/movie/clip2/NNNN.png（映像の場面。JSON の keyframes の png）

■ 指紋（116 9 v → 下画面の状態 0x29、探偵パートの遊び 6 → 仕事 0x11 = 0x02080680。モードの表 0x020c977c）
  v = game+0xb（0x02319244）。版の表 0x020c974c（16 バイト × 3: u32 背景, u32 戻る背景, u8 +8 ?, u8 +9 所の数,
  u8 +0xa 正解の人物, u32 +0xc 所の表）。所 = 0x2e バイト: +0 絵の位置, +0x14 当たりの四角形（4 点）,
  +0x2a = 1 なら「本物の指紋」の所, +0x2b 大きく見せる絵。
  - モード 1（0x0207fe78）: 版 0 なら出来事 0（説明）の区画を走らせてからモード 3、ほかは直接モード 3。
  - モード 3（0x0207f700）: カーソルの 4×4 と所の四角形（0x0202274c）で選ぶ。版 0 だけフラグ 0x1c（組 0）で選べる所が
    替わる（立っていなければ +0x2a ≠ 1 の所、立っていれば +0x2a = 1 の所）。A でモード 4、B は版 0 以外だけ（やめる → モード 11）。
  - モード 4（0x0207f080）: 版 0 でフラグ 0x1b が立っていなければ立てて、出来事 1（検出の説明）。
  - モード 5（0x0207eb08）: 粉をかけて吹きとばす。B で出来事 3（版 0。ほかは 8）→ 選び直し。検出できたら（0x0206e834）
    版 0: +0x2a = 1 なら出来事 6 → 照合（モード 9）、ほかは出来事 2 とフラグ 0x1c → 選び直し。版 1・2: モード 6
    （+0x2a = 1 なら照合、ほかは出来事 9 → 選び直し）。
  - 照合（モード 9 → 10 → 人物を選ぶ仕事 0x17 → モード 8）: 選んだ枠の人物（0x020b10f4）が版の +0xa と同じなら
    モード 11（0x0207c708）で成功の区画、違えば版 0 は出来事 4、版 2 は出来事 7、版 1 は何もなく選び直し（0x0207e2b0〜）。
    出来事 4・7 の後は人物を選ぶ画面に戻る（戻り先 0x0231922c = モード 10、0x023191fc = 段 2）。
  - モード 11: 版 0 と成功（+3 ≠ 1）は成功の区画。やめた（+3 = 1。モード 3 の B、0x0207fe40）ときは区画を走らせず
    探偵パートへ戻る（0x0207cb80）。版 1 はどちらでも法廷記録を開けるように戻す（game+0x90 の bit 4 を消す、0x0207cb20）。
  - 出来事 → 区画: 0x0207c0fc の分かれ道の r4（0x80 を引いた値が区画）。出来事 8・9 は項目 070 の区画（0x0207c19c）。
    版ごとの出来事（FP_FLOW の番地の即値）: B でもどる 3 / 8、本物でない指紋を検出 2 / 9、照合の外れ 4 / なし / 7。
■ 人物を選ぶ画面（仕事 0x17 = 0x0208b530）: 枠 8 つ（0x020b1518: u16 x, y, 幅, 高さ。4 つずつ 2 段）、枠の人物 0x020b1490
  （u8 × 8。人物の番号 0＝茜、1＝巴、2＝罪門恭介、3＝市ノ谷、4＝多田敷、5＝原灰、6＝巌徒、7＝糸鋸）、人物の顔の絵 0x020b14a8
  （u16 × 8、法廷記録のアイコンの番号）。十字キーで枠を動かし（0x0208af74〜。B は無く、やめられない）、A で決める（0x0208b08c）。
  - 116 10 n（人物の指名。下画面の状態 0x2f → 探偵パートの遊び 9 / 法廷の遊び 0xd → 仕事 0x17、game+0xb = n）: 結果の表
    0x020b1558（12 バイト × 9: u8 n, u8 正解の人物, u32 正解の区画, u32 外れの区画）の n 番（0x02087e68 / 0x02089ce4:
    n ≤ 2 は指紋の照合へ戻る）。選んだ枠の人物が正解の人物なら正解の区画、違えば外れの区画を走らせる。
■ 金庫の暗証番号（116 8 52 → 下画面の状態 0x34 → 探偵パートの遊び 8 → 仕事 0x15 = 0x0207a3dc、060 §156）: 背景 200 の
  ボタン（0x020c9894: u16 x, y, 幅, 高さ × 11。0x020796f8 で読む。絵の文字は 0〜8 番 = 1〜9、9 番 = 0、10 番 = ←もどる）を
  触る（キーは読まない。やめられない）。0〜9 番はその番号を入力の列 0x02319304 に足し、10 番は 1 字消す（0x0207992c〜）。
  7 字になると以後の入力は受け付けず（0x020798e4）、60 フレーム後に答え 0x020c9480（ボタンの番号 × 7。0x02079ac8）と
  比べ（0x02079ad8）、合えば 0x02079f34 の区画、違えば 0x02079f40 の区画（0x02079f28）。
■ 選択肢で近似する遊び（CHOICES。結果の区画だけを番地の命令から読む。操作は元のゲームのとおりには作れない）
  - ツボの正しい見かた（116 8 51 → 状態 0x33 → 法廷の遊び 0xc → 仕事 0x14 = 0x0207b454、062 §59・§60）: 3D のツボを
    3 つの軸で回して X（または下画面のボタン）で提示する。回した向きの 3 つの角度が決まった幅に入っていれば（0x0207afd4〜）
    正しい見かたの区画（0x0207a904）、違えば違う区画（0x0207a910。r0 は 0x0207a720 の 0xbc のまま）。やめられない。
  - 点をつないで字を書く（116 8 62 → 状態 0x3e → 法廷の遊び 0xe → 仕事 0x12 = 0x0207743c、062 §69）: 15 の点を線で結び、
    決める（ボタン 4 か X）と、線の集まりが表（0x020c0d20）に合えば（0x0206da74）0x02076e80 の区画、違えば 0x02076e8c の区画。
  - 最後の場面（068 §5）: 116 12 0 でツボの仕事 0x1a を積んだ後の 116 8 46 は、3D の画面（仕事 0xd、+0xe9d = 0x1e。
    0x02072388〜）で物 0x1d（0x0208b734）を見せる。面を調べると結果 7（examine3d.json）の区画、何もしないで 0x4b0 フレーム
    （0x0208bee8）たつと 0x0208bf18 の区画。閉じられない。
■ 映像（116 8 53 → 法廷の遊び 0xb → 仕事 0x16 = 0x020791dc）: 版 = 今の区画の番号で決まる（0x02052d98〜）。
  場面の絵は動画 2（0x02079160 → 0x0206b6b4、動画の表 0x020c0c04）。指したときの区画は 0x0206a4c8:
  表 0x020c0c54（0x14 バイト × 4: u16 始めの場面, u16 終わりの場面, u32 当たりの絵の位置, u32 大きさ, u16 × 4 版ごとの区画）
  を順に見て、場面が範囲に入り、カーソルの 16×16 に当たりの絵（1bpp）の点があればその区画、どれでもなければ 0x020c0cb0。
■ ツボ（116 8 50 → 探偵パートの遊び 7 → 仕事 0x1a = 0x020726c8）: やめると 0x02072ad8〜、組み立て終えると 0x02074834〜。
  フラグ 0x1d（組 0）で区画と背景が替わり、組み立て終えたら 0x02074978 でフラグを立てる。
"""
import json
import os
import re
import struct
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gfx  # noqa: E402
import nds  # noqa: E402
from arm9 import Arm9  # noqa: E402
from nitro import decompress  # noqa: E402
from tbl_examine3d import imm  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
FP_VARIANTS, FP_SPOT = 0x020c974c, 0x2e
FP_EVENTS = 0x0207c0fc  # 出来事の番号の分かれ道（10 個）
FP_SUCCESS = [(0x0207cadc, 0), (0x0207cb08, 1), (0x0207cb5c, 2)]  # モード 11 の成功の区画（ldr r0, =値）
PERSONS, PERSON_ICONS, SLOT_RECTS = 0x020b1490, 0x020b14a8, 0x020b1518
NOMINATIONS, N_NOMINATIONS = 0x020b1558, 9  # 12 バイト × 9（0〜2 は指紋の照合で使わない）
#: 版ごとの出来事の番号（版 → (番地, 命令の形)。None = 出来事なし）。B でもどる・本物でない指紋・照合の外れ
FP_FLOW = {
    'back': [(0x0207ef80, 'mov r5, #'), (0x0207efc8, 'mov r3, #'), (0x0207efc8, 'mov r3, #')],
    'fake': [(0x0207ed3c, 'mov r1, #'), (0x0207ea7c, 'mov r1, #'), (0x0207ea7c, 'mov r1, #')],
    'wrong': [(0x0207e2f4, 'mov r1, #'), None, (0x0207e3ac, 'mov r1, #')],
}
VIDEO_RECS, VIDEO_MISS, N_VIDEO_RECS, CLIPS = 0x020c0c54, 0x020c0cb0, 4, 0x020c0c04
#: 映像の版を決める所（区画の値を比べる命令, 版を入れる命令）
VIDEO_VARIANTS = [((0x02052dbc, 'cmp r0, #'), (0x02052e04, 'mov r1, #')),
                  ((0x02052da8, 'cmp r0, #'), (0x02052e18, 'mov r1, #')),
                  ((0x02052dd0, 'cmp r0, #'), (0x02052dd8, 'moveq r1, #')),
                  ((0x02052de8, 'cmp r0, #'), (0x02052df0, 'moveq r1, #'))]
#: 金庫: ボタンの表を読む命令（ldr r6）と数、答えの表を読む命令（ldr r1）と字数の命令、合う・違うの区画の命令（ldr r0）
SAFE = {'rects': (0x020796f8, 11), 'answer': (0x02079ac8, 0x02079ad4), 'ok': 0x02079f34, 'ng': 0x02079f40}
#: 金庫のボタンの絵の文字（背景 200 の絵で確かめたもの。ARM9 はボタンの番号で比べる）
SAFE_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'もどる']
#: 選択肢で近似する遊び: 116 8 の値 → 選択肢（文, 区画を読む命令（番地, 形））。after_ui12 = 116 12 の後だけ
CHOICES = [
    {'ui': 51, 'about': 'ツボの正しい見かたを提示する', 'options': [
        ('正しい見かたを提示する', (0x0207a904, 'mov r0, #')), ('ちがう見かたを提示する', (0x0207a720, 'mov r0, #'))]},
    {'ui': 62, 'about': '点をつないで字を書く', 'options': [
        ('正しく点をつなぐ', (0x02076e80, 'mov r0, #')), ('ちがうようにつなぐ', (0x02076e8c, 'mov r0, #'))]},
    {'ui': 46, 'after_ui12': True, 'about': '最後の場面で 3D の物を見せる', 'examine_object': (0x0208b734, 'mov r1, #'),
     'options': [('調べる', None), ('何もしないで待つ', (0x0208bf18, 'mov r0, #'))]},
]
VASE = {'flag': (0x02072ad8, 'mov r1, #'), 'flag_set': (0x02074978, 'mov r1, #'),
        'quit': {'unset': 0x02072b10, 'set': 0x02072b44}, 'complete': {'unset': 0x02074860, 'set': 0x02074894},
        'bg': {'unset': (0x0207484c, 'mov r1, #'), 'set': (0x02074870, 'mov r1, #')}}


def ldr_value(a9: Arm9, addr: int, reg: str) -> int:
    """番地の命令が「mov reg, #値」か「ldr reg, =値」であることを確かめて、値を返す"""
    line = a9.disasm(addr, 1)[0]
    m = re.search(rf'(?:mov|ldr)\s+{reg}, (?:#(0x[0-9a-f]+|\d+)$|\[pc.*=(0x[0-9a-f]+)$)', line)
    if not m:
        raise SystemExit(f'想定と違う命令です: {line}（{reg}）')
    return int(m.group(1) or m.group(2), 0)


def sec(raw: int, script: str = 'story') -> dict:
    return {'raw': raw, 'section': raw - 0x80, 'script': script}


def fp_events(a9: Arm9) -> list[dict]:
    out = []
    for k in range(10):
        line = a9.disasm(FP_EVENTS + 4 * k, 1)[0]
        target = int(re.search(r'b\s+#(0x[0-9a-f]+)$', line).group(1), 0)
        # 出来事 8・9 は項目 070（0x0207c19c: 番号 - 8 が 1 以下なら 0xffff を読み込む）
        out.append({'event': k, **sec(ldr_value(a9, target, 'r4'), '070' if k >= 8 else 'story')})
    return out


def bbox(points: list[tuple[int, int]]) -> list[int]:
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    return [min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1]


def fp_variants(a9: Arm9) -> list[dict]:
    out = []
    success = {v: ldr_value(a9, addr, 'r0') for addr, v in FP_SUCCESS}
    for v in range(3):
        base = FP_VARIANTS + 16 * v
        bg, bg_return, ptr = a9.u32(base), a9.u32(base + 4), a9.u32(base + 12)
        spots = []
        for i in range(a9.u8(base + 9)):
            h = struct.unpack('<23h', a9.read(ptr + i * FP_SPOT, FP_SPOT))
            quad = [(h[10 + 2 * k], h[11 + 2 * k]) for k in range(4)]
            spots.append({'index': i, 'quad': quad, 'area': bbox(quad),
                          'real': a9.u8(ptr + i * FP_SPOT + 0x2a) == 1, 'closeup': a9.u8(ptr + i * FP_SPOT + 0x2b)})
        out.append({'variant': v, 'bg': bg, 'bg_return': bg_return, 'answer_person': a9.u8(base + 10),
                    'spots': spots, 'success': sec(success[v]), 'can_quit': v != 0})
    return out


def fp_flow(a9: Arm9) -> dict:
    # 版 1 の照合の外れ: 出来事を走らせず人物を選ぶ画面（モード 10）へ戻る
    if imm(a9, 0x0207e350, 'moveq r0, #') != 0xa:
        raise SystemExit('版 1 の照合の外れが想定と違います')
    return {k: [None if at is None else imm(a9, *at) for at in v] for k, v in FP_FLOW.items()}


def nominations(a9: Arm9) -> list[dict]:
    out = []
    for n in range(N_NOMINATIONS):
        base = NOMINATIONS + 12 * n
        if a9.u8(base) != n:
            raise SystemExit(f'人物の指名の表の {n} 番が想定と違います')
        ok, ng = a9.u32(base + 4), a9.u32(base + 8)
        if ok and ng:
            out.append({'n': n, 'answer_person': a9.u8(base + 1), 'answer': sec(ok), 'wrong': sec(ng)})
    return out


def persons(a9: Arm9) -> list[dict]:
    out = []
    for slot in range(8):
        p = a9.u8(PERSONS + slot)
        out.append({'slot': slot, 'person': p, 'icon': a9.u16(PERSON_ICONS + 2 * p),
                    'rect': [a9.u16(SLOT_RECTS + 8 * slot + 2 * k) for k in range(4)]})
    return out


def video(a9: Arm9, d: bytes, out_dir: Path) -> dict:
    variants = [{'section': sec(imm(a9, *c)), 'variant': imm(a9, *v)} for c, v in VIDEO_VARIANTS]
    clip = imm(a9, 0x02079160, 'mov r1, #')
    clip_ptr, n_frames = a9.u32(CLIPS + 16 * clip), a9.u16(CLIPS + 16 * clip + 8)
    recs = []
    for r in range(N_VIDEO_RECS):
        s, e, ptr = struct.unpack('<HHI', a9.read(VIDEO_RECS + 0x14 * r, 8))
        recs.append({'frames': [s, e], 'mask': ptr, 'sections': [sec(a9.u16(VIDEO_RECS + 0x14 * r + 0xc + 2 * v))
                                                                 for v in range(4)]})
    miss = [sec(a9.u16(VIDEO_MISS + 2 * v)) for v in range(4)]

    def mask(r: int, f: int) -> np.ndarray | None:
        s, e = recs[r]['frames']
        if not s <= f <= e:
            return None
        off, _ = struct.unpack_from('<II', d, recs[r]['mask'] + 4 + 8 * (f - s))
        return gfx.unpack1(decompress(d, recs[r]['mask'] + off)[0]).reshape(192, 256)

    def area(m: np.ndarray) -> list[int] | None:
        ys, xs = np.nonzero(m)
        if not len(xs):
            return None
        # カーソルの 16×16（-8〜+7）に点があれば当たるので、点の範囲を 7〜8 ドット広げる
        x0, y0 = max(0, int(xs.min()) - 7), max(0, int(ys.min()) - 7)
        x1, y1 = min(255, int(xs.max()) + 8), min(191, int(ys.max()) + 8)
        return [x0, y0, x1 - x0 + 1, y1 - y0 + 1]

    # 場面: 当たりの範囲ごとに、当たりの点がある場面の真ん中と、当たりのない場面を少し（早送り・早戻しの代わりに送る絵）
    picks = {0, 300, 700, 1150}
    for r in range(N_VIDEO_RECS):
        s, e = recs[r]['frames']
        shown = [f for f in range(s, e + 1) if mask(r, f).any()]
        picks.add(shown[len(shown) // 2])
    keyframes = []
    (out_dir / 'data/movie' / f'clip{clip}').mkdir(parents=True, exist_ok=True)
    for f in sorted(picks):
        off, _ = struct.unpack_from('<II', d, clip_ptr + 4 + 8 * f)
        raw = decompress(d, clip_ptr + off)[0]
        png = f'data/movie/clip{clip}/{f:04d}.png'
        gfx.write_png(out_dir / png, gfx.decode(raw[32:], 256, 192, 4), gfx.palette(raw[:32]))
        areas = [{'record': r, 'area': a} for r in range(N_VIDEO_RECS)
                 if (m := mask(r, f)) is not None and (a := area(m)) is not None]
        keyframes.append({'frame': f, 'png': png, 'key': f'movie{clip}_{f:04d}', 'areas': areas})
    return {'clip': clip, 'frames': n_frames, 'variants': variants, 'records': recs, 'miss': miss,
            'keyframes': keyframes}


def safe(a9: Arm9) -> dict:
    at, n = SAFE['rects']
    rects = ldr_value(a9, at, 'r6')
    ans_at, len_at = SAFE['answer']
    answer = ldr_value(a9, ans_at, 'r1')
    digits = imm(a9, len_at, 'mov r2, #')
    return {'buttons': [{'index': i, 'label': SAFE_LABELS[i], 'area': [a9.u16(rects + 8 * i + 2 * k) for k in range(4)]}
                        for i in range(n)],
            'answer': [a9.u8(answer + k) for k in range(digits)],
            'delete': n - 1,
            'correct': sec(ldr_value(a9, SAFE['ok'], 'r0')), 'wrong': sec(ldr_value(a9, SAFE['ng'], 'r0'))}


def choices(a9: Arm9) -> list[dict]:
    out = []
    for c in CHOICES:
        row = {k: v for k, v in c.items() if k not in ('options', 'examine_object')}
        if 'examine_object' in c:
            # 物を調べた結果の区画は examine3d.json（物の面の結果）から。ここでは物の番号だけ
            row['examine_object'] = imm(a9, *c['examine_object'])
        row['options'] = [{'text': t, 'section': sec(imm(a9, *at)) if at else None} for t, at in c['options']]
        out.append(row)
    return out


def vase(a9: Arm9, out_dir: Path) -> dict:
    flag = imm(a9, *VASE['flag'])
    if imm(a9, *VASE['flag_set']) != flag:
        raise SystemExit('ツボのフラグが合いません')
    doc = {'flag': flag,
           'quit': {k: sec(ldr_value(a9, a, 'r0')) for k, a in VASE['quit'].items()},
           'complete': {k: sec(ldr_value(a9, a, 'r0')) for k, a in VASE['complete'].items()},
           'bg': {k: imm(a9, *v) for k, v in VASE['bg'].items()}}
    # 組み立てる所（3D のカケラを描く窓）: ツボの画面の背景 0xb2（0x0207559c）の緑の抜き色の範囲
    from PIL import Image
    rows = json.loads((out_dir / 'tables/bg_render.json').read_text())['backgrounds']
    png = next(r['png'] for r in rows if r['id'] == imm(a9, 0x0207559c, 'mov r1, #'))
    px = np.asarray(Image.open(out_dir / png).convert('RGB'))
    ys, xs = np.nonzero((px[:, :, 1] > 200) & (px[:, :, 0] < 64) & (px[:, :, 2] < 64))
    doc['area'] = [int(xs.min()), int(ys.min()), int(xs.max() - xs.min() + 1), int(ys.max() - ys.min() + 1)]
    return doc


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    rom = Path(sys.argv[1]).read_bytes()
    out_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / 'assets/extracted'
    a9 = Arm9(rom)
    f = next(f for f in nds.list_files(rom) if f.path == 'data.bin')
    d = rom[f.start:f.end]
    doc = {
        '_about': '第 5 話の DS 版だけの遊び。tools/rom/tbl_minigames.py の先頭の説明を参照。section は区画の番号'
                  '（raw - 0x80）、script = story（今のパートの台本）/ 070（項目 070）。area は [x, y, 幅, 高さ]（下画面の座標）',
        'fingerprint': {'events': fp_events(a9), 'variants': fp_variants(a9), 'flow': fp_flow(a9),
                        'persons': persons(a9), 'flags': {'tutorial': 0x1b, 'glove': 0x1c}},
        'nominations': nominations(a9),
        'video': video(a9, d, out_dir),
        'vase': vase(a9, out_dir),
        'safe': safe(a9),
        'choices': choices(a9),
    }
    out = out_dir / 'tables/minigames.json'
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    v = doc['video']
    print(f'{out}: 指紋の版 {len(doc["fingerprint"]["variants"])}、映像の当たり {len(v["records"])}・場面 {len(v["keyframes"])}')


if __name__ == '__main__':
    main()
