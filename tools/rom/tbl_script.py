# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""台本（mes_all.bin）の区画とラベル、命令の意味、エンジンの定数を JSON に書き出す。

    uv run tools/rom/tbl_script.py <rom.nds> [出力先（既定: assets/extracted/tables）]

出力:
  opcodes.json  命令 0〜127 の意味（op_semantics_a.py / _b.py）: 名前・引数・止まり方・意味・YAML への書き換え・確かさ・関数の番地
  labels.json   項目ごとの区画の数とラベル（見出しの末尾。54/53/120/122 の飛び先）
  engine.json   文字・色・速さ・フェードなどエンジンが必要とする定数（ARM9 から読んだ値）
  ds_fx.json    105（DS 版の演出）の効果の番号ごとのメモと使われた回数

見出しの読み方（ARM9 0x02024f28 と 0x02029478 で確認）:
  項目を展開すると u32 N、u32 × N の見出し。見出しの前から k 個が区画の位置（項目の先頭からのバイト位置、区画は nop で始まる）、
  残り N-k 個がラベル = (区画 << 16) | 区画内のバイト位置。区画の読み込みも 54 もこの同じ表を「添字 × 4 + 4」で引く。
  区画の番号（文脈 +0x4a）は 0x80 + k 番目（話の台本は 0x0211e460 に、共通の項目 72/73 は 0x020db020 に読み込まれ、+0x4a < 0x80 が共通）。
"""
import json
import os
import struct
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from arm9 import Arm9  # noqa: E402
from nds import list_files  # noqa: E402
from nitro import decompress  # noqa: E402
from op_semantics_a import OPS_A  # noqa: E402
from op_semantics_b import OPS_B  # noqa: E402
from script_format import ARGC  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def items(rom: bytes) -> list[bytes]:
    f = next(f for f in list_files(rom) if f.path == 'mes_all.bin')
    mes = rom[f.start:f.end]
    n = struct.unpack_from('<I', mes, 0)[0]
    return [decompress(mes, struct.unpack_from('<I', mes, 4 + i * 8)[0])[0] for i in range(n)]


def split_header(d: bytes) -> tuple[list[int], list[tuple[int, int]]]:
    """見出しを (区画の位置の一覧, ラベル [(区画, バイト位置)]) に分ける"""
    n = struct.unpack_from('<I', d, 0)[0]
    v = struct.unpack_from(f'<{n}I', d, 4)
    k = 0
    while k < n and v[k] < len(d) and (k == 0 or v[k] > v[k - 1]) and struct.unpack_from('<H', d, v[k])[0] == 0:
        k += 1
    labels = [(x >> 16, x & 0xfffe) for x in v[k:]]
    assert all(s < k for s, _ in labels), 'ラベルの区画が範囲外'
    return list(v[:k]), labels


def opcodes_json() -> dict:
    ops = {**OPS_A, **OPS_B}
    out = {}
    for o in range(128):
        name, args, block, desc, yaml, conf, addr = ops.get(o, (f'op{o}', [], '?', '未調査', '', '低', None))
        assert len(args) == ARGC[o] or name.startswith(('nop', 'unused')), (o, name, args, ARGC[o])
        out[str(o)] = {'name': name, 'argc': ARGC[o], 'args': args, 'blocks': block, 'desc': desc,
                       'yaml': yaml, 'confidence': conf, 'handler': f'{addr:#010x}' if addr else None}
    return out


def engine_json(a: Arm9) -> dict:
    en_speed = [a.u32(0x020b3e68 + i * 4) & 0xff for i in range(16)]
    gameover = [a.u16(0x020aad40 + i * 2) for i in range(35)]
    return {
        'fps': 60,
        '_fps_note': '主ループ 0x02000b98 は game+0x11 回の VBlank を待つ。0x02017fa4 で 1 にしている → 1 フレーム = 1/60 秒',
        'text': {
            'glyph': {'data_bin': 0x01bcb374, 'size': [16, 16], 'bpp': 4, 'bytes': 0x80,
                      'en_small_font': 0x01bfc374, '_note': '英語で文字番号 <= 0xff は別の字形（0x01bfc374）'},
            'advance_px': {'ja': 14, 'en': 'ARM9 0x020b3f28[文字]（番号 >= 0x110 は 14）'},
            'line_height_px': {'ja': 18, 'en': 16},
            'max_chars_per_line': 32,
            'origin': {'x': 9, 'y_ja': 0x94, 'y_en': 0x86, '_note': '文脈 +0x44/+0x46。72 で変わる'},
            'palette_data_bin': 0x01bcb354,
            'colors': {'0': '#f7f7f7', '1': '#f7733a', '2': '#6bc5f7', '3': '#00f700',
                       '_note': '色 c は字形の画素の番号 1〜3 を 1+3c〜3+3c に置き換える。影/縁は #636363 系'},
            'speed_default': 3,
            'speed_en_table': en_speed,
            'char_timing': '文字は「速さ」フレームに 1 個（カウンタが速さに達したフレームに出す）。0 = 同じフレームで全部',
            'page_advance_se': 0x2f,
            'blip': 'sound.json の blip',
        },
        'textbox_palette_data_bin': 0x01a807b4,
        'life': {'max': 5, 'addr': 'game+0x6b', 'penalty_se': 0x4c,
                 'gameover_section_by_part': gameover,
                 '_note': '値は区画 + 128（0 = 無し）。添字 = パート（game+0x69、項目 = 2×パート + 言語）'},
        'fade': {
            'types': {'1': 'BLDY を下げる（黒から戻す）', '2': 'BLDY を上げる（黒へ）', '3': '白から戻す', '4': '白へ', '5': '白を一度だけ量ぶん足す'},
            'bldcnt_black': '対象 | 0xc0', 'bldcnt_white': '対象 | 0xa0', 'bldcnt_default': 0x1d42,
            'white_flash_769_8_31': 'BLDY 24(=16 扱い), 16, 8, 0 → 白 2 フレーム + 半分 1 フレーム',
        },
        'shake_amplitude_px': {'0': 1, '1': 3, '2': 7, 'other': 3},
        'bg_change_latency_frames': 7,
        'pan': {'tables': {'short(0..65 tile)': [a.u16(0x020b3dc0 + i * 2) for i in range(16)],
                           'long(0..130 tile)': [a.u16(0x020b3de0 + i * 2) for i in range(16)]},
                'frames': 31, 'unit_px': 8, 'counter': '0x020ce16c+0xc を毎フレーム ±1（0x02017e88）、偶数で描く'},
        'section_entry_reset': {
            '_note': '区画に入るたび（0x02024d5c、13/10/54/8/9 などすべての飛び先）に文脈が初期化される。YAML では各 scene の頭で次の値に戻す',
            'text': '消す', 'color': 0, 'speed': 3, 'align': 0, 'speaker(+0x60)': 0, 'blip_kind(+0x33)': 0,
            'text_origin': '(9, 0x94)', 'next': '今の区画 + 1', 'press(+0x58)': 0, 'ctx_flags(+0)': 0,
            'not_reset': '背景・人物・枠の表示・音楽・フラグ・体力・名札の絵（次の 28 0 で名前 0 として描き直される）'},
        'present_se': 0x31, 'item_slide_se': 0x33, 'choice_move_se': 0x2a, 'choice_ok_se': 0x2b,
    }


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    rom = open(sys.argv[1], 'rb').read()
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else ROOT / 'assets/extracted/tables'
    out.mkdir(parents=True, exist_ok=True)
    a = Arm9(rom)
    labels = {}
    for i, d in enumerate(items(rom)):
        secs, labs = split_header(d)
        labels[f'{i:03}'] = {'sections': len(secs),
                             'labels': {str(len(secs) + j): {'section': s, 'offset': o} for j, (s, o) in enumerate(labs)}}
    from ds_fx import DS_FX, count_fx
    fx = count_fx(items(rom))
    json.dump(opcodes_json(), open(out / 'opcodes.json', 'w'), ensure_ascii=False, indent=1)
    json.dump({'_doc': '項目ごとの区画の数とラベル。ラベルの鍵 = 見出しの添字（54/53(0x80)/120/122 の引数）。offset は区画の先頭からのバイト位置',
               'items': labels}, open(out / 'labels.json', 'w'), ensure_ascii=False, indent=1)
    json.dump(engine_json(a), open(out / 'engine.json', 'w'), ensure_ascii=False, indent=1)
    json.dump({'_doc': '105 98 (段<<8 | 効果)。段 1 = 終わるまで止まる、2 = 止まらない。107 a b c は 文脈 +0x8a/+0x8c/+0x8e（効果の引数）',
               'effects': {str(k): {**DS_FX.get(k, {'desc': '未調査'}), 'uses': v} for k, v in sorted(fx.items())}},
              open(out / 'ds_fx.json', 'w'), ensure_ascii=False, indent=1)
    print(f'{out}: opcodes.json labels.json engine.json ds_fx.json（ラベル {sum(len(x["labels"]) for x in labels.values())} 個）')


if __name__ == '__main__':
    main()
