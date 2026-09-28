"""探偵パートの表の番地（ゲームごと）。tbl_invest.py / tbl_invest_start.py から使う。

蘇る逆転（AGYJ）の値は tbl_invest.py の先頭の説明と tbl_invest_sym.py の CALLS。2（A2GJ）・3（YG3J）は同じ形の
コードを探して対応させたもの（関数の中身・定数の表・呼び出しの形で確かめた）。
"""
from __future__ import annotations

from dataclasses import dataclass, field

from tbl_invest_sym import AGYJ as SYM_AGYJ, SymCfg


@dataclass(frozen=True)
class InvestAddrs:
    code: str
    #: パートの数（パートごとの表の長さ）
    parts: int
    #: パートごとの表: 始めの関数・法廷のつきつけ・始めの法廷記録・つきつけ・着いたとき・毎フレーム
    t_init: int
    t_court_present: int
    t_record: int
    t_present: int
    t_arrive: int
    t_frame: int
    #: 何もしない関数（始めの関数がこれ = 法廷のパート）
    nop: int
    #: 始めの関数が表を写す先（場所・話題・調べる場所）
    places_ram: int
    talk_ram: int
    examine_ram: int
    #: 記号実行の設定（ゲーム全体の状態・呼ぶ関数の名前）
    sym: SymCfg
    #: つきつけの表の 1 項目の大きさ（蘇る逆転 8、2 = 0xa、3 = 0xe。形は tbl_invest.parse_present）
    present_row: int = 8
    #: 始めの関数が写すもう 1 つの表（2・3: 89 op89 の区画の表）の先
    extra_ram: int | None = None
    #: 場所・話題の名前のテクスチャ（data.bin の中の位置。見つかっていないもの（2・3 の移動先の小さな絵）は None）
    place_tex: dict | None = None
    topic_tex: dict | None = None
    thumb_tex: dict | None = None
    n_place_tex: int = 0
    n_topic_tex: int = 0
    n_thumb: int = 0
    #: 62 op62 k の問題の表（k × 0x2c）と個数
    court_point: int = 0
    n_court_point: int = 0
    #: 調べる場所の表の [2] = 0xfd のときの条件
    examine_cond: dict = field(default_factory=dict)
    #: パート → 台本の項目（日本語。None なら パート × 2）の表（u32 × parts、項目 = 値 × 2）
    part_items: int | None = None
    #: 3: 項目を読み込む関数（0x020265e8）の中の switch（k → 項目）の先頭
    item_switch: int | None = None
    #: rules に足す説明（調べるの特別な場合など）
    notes: dict = field(default_factory=dict)


AGYJ = InvestAddrs(
    'AGYJ', 35, 0x020b443c, 0x020b44c8, 0x020b4554, 0x020b45e0, 0x020b466c, 0x020b46f8, 0x0202884c,
    0x020ceeb0, 0x020ce8a8, 0x020ceb28, SYM_AGYJ,
    place_tex={'ja': 0x026a23c8, 'en': 0x026b1778}, topic_tex={'ja': 0x026c0b28, 'en': 0x02726f58},
    thumb_tex={'ja': 0x0278d388, 'en': 0x02804fcc}, n_place_tex=28, n_topic_tex=188, n_thumb=29,
    court_point=0x020aafd0, n_court_point=13,
    examine_cond={
        0x0d: 'flag 0x49 == 1', 0x0e: 'flag 0x72 == 0', 0x0f: 'never', 0x10: 'always', 0x11: 'flag 0xa0 == 0',
        0x12: 'part in 17..18 and flag 0x43 == 0', 0x13: 'part in 17..18 and flag 0x44 == 0', 0xba: 'flag 0x44 == 1',
    },
)

#: 2 の動作の関数（蘇る逆転の CALLS と同じ名前は同じ働き）
CALLS_A2GJ: dict = {
    0x020294f0: 'event',        # (区画, フラグ): 0x0202887c と同じ（フラグ 0xff = 印なし）
    0x020294c8: 'event_keep_bgm',  # (区画, フラグ): 同上。音楽を止めない版（文字の枠は 7）
    0x0202951c: 'char',         # (人物, 話す動き, 黙る動き)（game+0x88/0x8a に記録）
    0x020262fc: 'bgm',          # (番号)
    0x02026224: 'bgm_stop',     # ()
    0x020070c8: 'copy',         # (元, 先, 大きさ)
    0x0200707c: 'fill',         # (値, 先, 大きさ)
    0x02019ed8: 'set_flag',     # (組, 番号, 値)
    0x0202321c: 'op_2232c',     # (番号): 0x02023190(番号, 0)。蘇る逆転の 0x0202232c と同じ形
    0x02036a14: 'place_state',  # (場所, 値): game+0x398+場所 = 値（81 op81 と同じ。つきつけの表の state と比べる）
    0x02025cb4: 'reload_script',  # (): 共通の台本と今のパートの台本の項目を読み直す
    0x02075ef8: 'gauge_full',   # (): game+0x66/0x68/0x76 = 0x50（体力のゲージを満たす。推測）
}
#: 3 の動作の関数
CALLS_YG3J: dict = {
    0x0202ac2c: 'event',        # (区画, フラグ): 同上（パート 7 の 0x14e・パート 14 の 0x95 だけ文字の枠 7）
    0x0202abb0: 'char',         # (人物, 話す動き, 黙る動き)（英語では動き 0xe3..0xec を 0x166.. に替える）
    0x020273c0: 'bgm',          # (番号)
    0x02027480: 'bgm_stop',     # ()
    0x0202740c: 'bgm_pause',    # (): 鳴っている音楽を止める（game+0x35 のビット 4 → 2。推測）
    0x02024d48: 'jump',         # (区画): 区画へ飛ぶ（event の中身）
    0x0201f450: 'box',          # (番号): 文字の枠の動き（event の中身。3 = 下げる）
    0x02007050: 'copy',         # (元, 先, 大きさ)
    0x02007098: 'fill',         # (値, 先, 大きさ)
    0x0201afc8: 'set_flag',     # (組, 番号, 値)
    0x020265d8: 'load_item',    # (k): 台本の項目を k の表（0x020265e8 の switch）の項目に替える（パートはそのまま）
    0x02088610: 'gauge_full',   # (): 同上（推測）
    0x02024d24: 'ctx',          # (): 文脈を返す（+0x88 = 今読み込んでいる k）
    0x020971c0: 'arrive_again',  # (): パート 2 の着いたときの関数（毎フレームの関数が game+0x84 を替えてから呼ぶ = 場所を移す）
}
#: 3 の「場所ごとに読み込む台本の項目を替える」関数（着いたときの関数から呼ぶ。中に入って続けて実行する）
INLINE_YG3J = {0x02096200, 0x02096a04, 0x02097150, 0x02097c7c, 0x02098268, 0x02098be8, 0x0209991c}

A2GJ = InvestAddrs(
    'A2GJ', 22, 0x02095754, 0x020957ac, 0x02095804, 0x0209585c, 0x020958b4, 0x0209590c, 0x020294c4,
    0x020abc54, 0x020aabb0, 0x020aae30,
    SymCfg(game=0x020abb30, calls=CALLS_A2GJ, inline=frozenset(), flag_test=0x02019eac, off_place=0x84, off_part=0x85,
           ext=True, rams=(('talk', 0x020aabb0, 0x280, 0x14), ('places', 0x020abc54, 0x100, 8), ('examine', 0x020aae30, 0x280, 0x14))),
    present_row=0xa, extra_ram=0x020aa2d0, court_point=0x0208ca98, n_court_point=8,
    # 名前のテクスチャ（蘇る逆転と同じ 128×32 が 0x8b4 おき）: 場所は移動の画面の 0x020562d0（日本語）・0x020562cc（英語）、
    # 話題は話すの画面の 0x02054ad4（日本語）・0x02054acc（英語）が直接持つ。場所 26 個・話題 141 個（日英が続けて並ぶ）
    place_tex={'ja': 0x00955648, 'en': 0x00963890}, topic_tex={'ja': 0x00971ad8, 'en': 0x009be5fc},
    n_place_tex=26, n_topic_tex=141,
    # 調べる（0x02035108）の [2] = 0xfd の条件
    examine_cond={
        0x0f: 'flag 0xa9 == 1 and flag 0xa5 == 1 and flag 0xb3 == 1 and flag 0x97 == 1 and flag 0xb5 == 0',
        0x1b: 'flag 0xe6 == 1', 0x1c: 'flag 0xe1 == 1', 0x1e: 'part == 19 and flag 0x99 == 0',
        0x20: 'flag 0x97 == 1 and flag 0x98 == 0',
    },
    notes={'examine': '調べる（0x02035108）: 表を見る前に パート 2・場所 5 でフラグ 0x41 = 1・0x48 = 0 なら区画 0xe8、'
                      'パート 14・場所 0 なら 0xc7、パート 15・場所 0 でフラグ 0xbc = 1 なら 0x14f、パート 18・場所 20 でフラグ 0x92 = 0 '
                      'なら 0xa5。どれにも当たらなければ パート 15・場所 23 = 0x15a、パート 18・場所 25/21 = 0x10c、ほかは 0x1f（共通の台本 §31）'},
)

YG3J = InvestAddrs(
    'YG3J', 23, 0x020ae86c, 0x020ae7b4, 0x020ae758, 0x020ae810, 0x020ae8c8, 0x020ae924, 0x0202ac90,
    0x020bf4b8, 0x020beb54, 0x020bedd4,
    SymCfg(game=0x020bf394, calls=CALLS_YG3J, inline=frozenset(INLINE_YG3J), flag_test=0x0201b014, off_place=0x84, off_part=0x85,
           off_ctx_item=0x88, ext=True,
           rams=(('talk', 0x020beb54, 0x280, 0x14), ('places', 0x020bf4b8, 0x100, 8), ('examine', 0x020bedd4, 0x280, 0x14))),
    present_row=0xe, extra_ram=0x020be5f4, court_point=0x020a4138, n_court_point=12,
    # 名前のテクスチャ: 言語ごとの先頭の表（[日本語, 英語]）を 0x020b4510（場所。移動の画面 0x0205093c で
    # 先頭 + 場所 × 0x8b4）・0x020b451c（話題。0x020530ac から読む）が持つ。場所 22 個・話題 128 個
    place_tex={'ja': 0x00902c74, 'en': 0x0090ebec}, topic_tex={'ja': 0x0091ab64, 'en': 0x00960564},
    n_place_tex=22, n_topic_tex=128,
    part_items=0x020a3cc0, item_switch=0x020265e8,
    # 調べる（0x02036124）の [2] = 0xfd の条件（0xbc だけ）
    examine_cond={0xbc: 'part == 7 and place == 8 and flag 0x72 == 0 and flag 0x6d == 0'},
    notes={'examine': '調べる（0x02036124）: 表を見る前に パート 2・場所 3 でフラグ 0x13 = 0・0xa = 1 なら区画 0x12a、'
                      'パート 4・場所 2 なら 0xe1。どれにも当たらなければ パート 15 = 0x23、ほかは 0x22',
           'part': 'パート（game+0x85）は 0〜22。パートの台本の項目 = 0x020a3cc0[パート] × 2（+ 言語）。106 op106 k と load_item k '
                   '（0x020265d8）は項目を 0x020265e8 の表の k 番目に替える（パートは変わらない）→ parts[].items、places[].script_items'},
)

BY_CODE = {g.code: g for g in (AGYJ, A2GJ, YG3J)}


def part_items(a9, g: InvestAddrs, part: int) -> list[str]:
    """パートで読み込む台本の項目（日本語）。蘇る逆転・2 = [パート × 2]。
    3 = 0x020a3cc0[パート] × 2 から次のパートの前まで（106 op106 や load_item で途中で替わる項目を含む）"""
    if g.part_items is None:
        return [f'{part * 2:03d}']
    lo = a9.u32(g.part_items + part * 4) * 2
    hi = a9.u32(g.part_items + (part + 1) * 4) * 2 if part + 1 < g.parts else _n_items(a9, g)
    return [f'{i:03d}' for i in range(lo, hi, 2)]


def _n_items(a9, g: InvestAddrs) -> int:
    """3: 最後の k の項目 + 2（= 台本の項目の数）"""
    return max(int(v) for v in _k_items(a9, g).values()) + 2


def _k_items(a9, g: InvestAddrs) -> dict[int, str]:
    """3: 0x020265e8 の switch（addls pc, pc, r6, lsl #2 の後の b の表）を読んで k → 項目（日本語）にする。
    各 case の始めの `add r3, r0, #N`（r0 = 言語）の N が項目。何もしない case（pop）は含めない"""
    import re
    lines = a9.disasm(g.item_switch, 40)
    i = next(n for n, x in enumerate(lines) if 'addls' in x and 'pc, pc' in x)
    n_case = int(re.search(r'cmp\s+r\d+, #(0x[0-9a-f]+|\d+)$', '\n'.join(lines[:i]), re.M).group(1), 0) + 1
    base = int(lines[i].split(':')[0], 16) + 8
    out = {}
    for k in range(n_case):
        tgt = int(re.search(r'#(0x[0-9a-f]+)', a9.disasm(base + k * 4, 1)[0]).group(1), 16)
        for x in a9.disasm(tgt, 3):
            if ' pop' in x or ' b ' in x:
                break
            m = re.search(r'add\s+r3, r0, #(0x[0-9a-f]+|\d+)', x)
            if m:
                out[k] = f'{int(m.group(1), 0):03d}'
                break
    return out


def item_of_k(a9, g: InvestAddrs, k: int | None) -> str | None:
    """3: load_item / 106 op106 の k → 項目"""
    if g.item_switch is None or k is None:
        return None
    return _k_items(a9, g).get(k)
