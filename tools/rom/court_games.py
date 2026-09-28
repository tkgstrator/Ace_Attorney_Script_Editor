"""法廷の表の、ゲームごとの番地とパートの数え方（tbl_court.py から使う）。

蘇る逆転（AGYJ）: パート = game(0x020ceda8)+0x69、項目 = 2 × パート + 言語。表は tbl_court.py の先頭の説明のとおり。

逆転裁判2（A2GJ）: パート = game(0x020abb30)+0x85（22 個）、項目 = 2 × パート + 言語（蘇る逆転と同じ）。
  - つきつけの正解の表: 0x020957ac（u32 × パート、行の形は蘇る逆転と同じ）。照合 0x0203119c、呼ぶのは 0x02032014。
    探偵パートの添字には、次の法廷のパートと同じ表が入っている（使われない）。
  - 尋問中の外れ: 共通の台本（項目 044/045）の §33〜36 から乱数（0x02032048: 0x02019f28() & 3）。
  - ライフはゲージ（game+0x66、0〜80）。減らすのは台本の 84（43 は何もしない）。0 になると表 0x0208c85c[パート] の区画へ。

逆転裁判3（YG3J）: パート = game(0x020bf394)+0x85（23 個）。パートの台本は 項目 = 2 × T[パート] + 言語
  （T = u32 の表 0x020a3cc0。読み込み 0x02024b98）。同じパートの残りの項目は途中で読み替える（106 k → 0x020265e8 の分岐）。
  - つきつけの正解の表: 0x020ae7b4（u32 × パート）。照合 0x020340c0 は蘇る逆転と違い、
      区画の上位 4 ビット（0xf000）が立った行は「106 で読み替えた項目」（文脈 +0x88 ≠ 0）のときだけ、立っていない行は元の項目のときだけ使う。
      証拠品の番号 0xff は「どれをつきつけても」一致する。
  - 尋問中の外れ（0x02032828〜）: パートで分かれる。パート 0〜1（第 1 話、千尋）§41〜44、12〜13（第 4 話、千尋）§45〜47、
    16〜17（第 5 話の最初の法廷、御剣が弁護）§48〜50、ほか §37〜40。どれも乱数 & 3（3 つのときは 0 と 3 が同じ区画）。
  - パートの種類 0x020a3f20（u8 × 23、3 = 法廷 / 4 = 探偵）。22（次のパートへ）は、法廷 → 探偵ならゲージを 40 回復する（0x0202cddc）。
  - ゲームオーバーの区画 0x020a3ef2（u16 × パート）。
"""
from __future__ import annotations

import struct
from dataclasses import dataclass, field

#: YG3J: 106 k → 読む項目（日本語）。0x020265e8 の分岐（add r3, r0, #項目）から読んだもの
SPLIT_106_YG3J_TABLE = 0x020265e8


@dataclass
class CourtGame:
    present_table: int
    #: ゲームオーバーの区画の表（u16 × パート。None = 無し）
    gameover_table: int | None
    n_parts: int
    common_item: int
    common_wrong: list[int]
    #: パートごとの外れの区画（common_wrong と違うもの）
    wrong_by_part: dict[int, list[int]] = field(default_factory=dict)
    #: 3: 区画の 0xf000 で読み替えた項目の行を分ける
    split_rows: bool = False
    #: 3: 証拠品の番号 0xff = どれでも
    wildcard_item: bool = False


def part_starts(code: str, a9) -> list[int]:
    """パート → そのパートの最初の項目（日本語）"""
    if code == 'YG3J':
        return [2 * a9.u32(0x020a3cc0 + 4 * p) for p in range(23)]
    return [2 * p for p in range({'AGYJ': 35, 'A2GJ': 22}[code])]


def owner_part(starts: list[int], item: int) -> int:
    """項目（日本語）が属するパート = 最初の項目がそれ以下の、いちばん後ろのパート"""
    return max(p for p, s in enumerate(starts) if s <= item)


def split_items_yg3j(a9) -> dict[int, int]:
    """106 k → 項目（日本語）。分岐表の各行き先の最初の add r3, r0, #n を読む"""
    base = 0x02026624  # addls pc, pc, r6, lsl #2 の番地。行き先の表は +8 から
    out = {}
    for k in range(0x1c):  # cmp r6, #0x1b
        at = base + 8 + 4 * k
        off = a9.u32(at) & 0xffffff
        dest = at + 8 + ((off - 0x1000000) if off & 0x800000 else off) * 4
        for i in range(4):
            ins = a9.u32(dest + 4 * i)
            if ins & 0xffff0000 == 0xe8bd0000:  # pop = 何もしない行き先（k = 0, 2）
                break
            # add r3, r0, #imm（0xe2803xxx）
            if ins & 0xfffff000 == 0xe2803000:
                out[k] = ins & 0xff
                break
    return out


def court_game(code: str) -> CourtGame:
    if code == 'AGYJ':
        return CourtGame(0x020b44c8, 0x020aad40, 35, 72, [45, 46, 47, 48])
    if code == 'A2GJ':
        # ゲームオーバーの区画: ゲージが 0 になったときの待機（0x02076100）が引く表 0x0208c85c（u16 × パート）
        return CourtGame(0x020957ac, 0x0208c85c, 22, 44, [33, 34, 35, 36])
    if code == 'YG3J':
        wrong = {**{p: [41, 42, 43, 44] for p in (0, 1)}, **{p: [45, 46, 47, 45] for p in (12, 13)},
                 **{p: [48, 49, 50, 48] for p in (16, 17)}}
        # ゲームオーバーの区画の表 0x020a3ef2（u16 × パート。ゲージの待機 0x02088404）
        return CourtGame(0x020ae7b4, 0x020a3ef2, 23, 84, [37, 38, 39, 40], wrong, split_rows=True, wildcard_item=True)
    raise ValueError(code)


def read_present_rows(a9, table: int, part: int) -> list[tuple]:
    p = a9.u32(table + 4 * part)
    rows = []
    while a9.u16(p) != 0xffff:
        rows.append(struct.unpack('<HHHBB', a9.read(p, 8)))
        p += 8
    return rows
