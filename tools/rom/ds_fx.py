"""命令 105（DS 版の演出）の効果の番号のメモと、台本で使われた回数の数え方。

105 98 (段 << 8 | 効果): 文脈 +0x70 = 0（第 1 引数の上位）、+0x71 = 98、+0x72 の下位 = 段、+0x73 = 効果。
  段 1: 0x020253b0 → 0x02067bf0 → 0x0205b19c(文脈) を毎フレーム呼び、効果が終わる（0x02025364 で +0x71 = 0x63、段を 0）まで台本を止める。
        終わるときに効果の側で読む位置を 105 の後ろへ進める。
  段 2: その場で一度 0x0205b19c を呼び、止まらない（1 フレームで終わる効果向け）。
  段 0: 設定だけ（+0x73 を決める）。
  第 1 引数が 0 で第 2 引数 >= 0x800: 文脈 +0x72 の上位 4 ビットだけを変える（0x2000 → 0x10 = 早送りの B を無視、0x1000 → 8）。
107 a b c: 効果への引数（文脈 +0x8a, +0x8c, +0x8e）。
効果の分岐は 0x0205b19c（0x0f〜0x13, 0x20, 0x26, 0x34〜0x36, 0x37〜0x77 の表, 0x7f）。
"""
import struct

DS_FX: dict[int, dict] = {
    17: {'name': 'gavel', 'desc': '木槌 1 回。背景を木槌（0x02018708(8)）にし、22 フレーム後に効果音 0x3a（107 の a ≠ 0 なら 0x6f）、'
         '10 フレーム・強さ 1 の揺れ（39 と同じ）、明るさの変化を入れて終わる。段 1 で使う（止まる）', 'conf': '中', 'frames': 22},
    19: {'name': 'gavel3', 'desc': '木槌 3 回（22, 32, 44 フレーム目に効果音 0x3a/0x6f と揺れ）。「静粛に!」の場面', 'conf': '中'},
    52: {'name': 'anim_flag', 'desc': '47 の動き（番号 = 107 の a）に旗 0x400 を立てる（動きを止める/最後で止める と推測）', 'conf': '低'},
    67: {'name': 'item_clear', 'desc': '19/118 の証拠品の絵をすぐ消す（文脈 +0x395 = 0、枠の BG を消す）。段 2', 'conf': '中'},
    101: {'name': 'choice_prep', 'desc': '選択肢の前: 揺れを止めて BG のずれを戻し、下画面の選択肢の見出しの動き（0x45 / 0x47、107 の b で選ぶ）を始める。段 1（出終わるまで止まる）', 'conf': '低'},
    113: {'name': 'sub_bg', 'desc': '下画面の背景を 107 の a で選ぶ: 0..4 → 背景 0x94..0x98、5 → 無し（0xfff）', 'conf': '中'},
    114: {'name': 'sub_fade_out', 'desc': '下画面を暗くする: 0x02017aa8(種類 2, 間隔 = a, 量 = b, 対象 = c)（18 と同じ計算）', 'conf': '高'},
    115: {'name': 'sub_fade_in', 'desc': '下画面を戻す: 0x02017aa8(種類 1, a, b, c)', 'conf': '高'},
    116: {'name': 'set_23a', 'desc': 'game+0x23a = 107 の a', 'conf': '中'},
    71: {'name': 'ctx_flag40', 'desc': '107 の a ≠ 0 なら文脈 +0 に 0x40、0 なら下ろす', 'conf': '中'},
    72: {'name': 'ctx4_1000', 'desc': '文脈 +4 に 0x1000 を立てる', 'conf': '中'},
    53: {'name': 'ctx4_200', 'desc': '文脈 +4 に 0x200 を立てる', 'conf': '中'},
}


def count_fx(items: list[bytes]) -> dict[int, dict]:
    """105 98 x の効果ごとに、段ごとの回数と使われた項目を数える"""
    from script_format import ARGC
    from tbl_script import split_header
    out: dict[int, dict] = {}
    for n, d in enumerate(items):
        secs, _ = split_header(d)
        bounds = secs + [len(d)]
        for s in range(len(secs)):
            words = struct.unpack_from(f'<{(bounds[s + 1] - bounds[s]) // 2}H', d, bounds[s])
            i = 0
            while i < len(words):
                w = words[i]
                if w >= 0x80:
                    i += 1
                    continue
                if w == 105 and i + 2 < len(words) and words[i + 1] == 98:
                    fx, stage = words[i + 2] & 0xff, words[i + 2] >> 8
                    e = out.setdefault(fx, {'count': 0, 'stages': {}, 'items': []})
                    e['count'] += 1
                    e['stages'][str(stage)] = e['stages'].get(str(stage), 0) + 1
                    if n not in e['items']:
                        e['items'].append(n)
                i += 1 + ARGC.get(w, 0)
    return out
