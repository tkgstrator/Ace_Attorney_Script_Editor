"""名札と法廷記録の表の、ゲームごとの場所（tbl_record.py から使う）。

番地は ARM9（0x02 で始まるもの）か data.bin の中の位置。どのゲームも同じ形の処理で、場所だけが違う。

蘇る逆転（AGYJ）: tbl_record.py の見出しの説明を見ること。

逆転裁判2（A2GJ）: 蘇る逆転と同じ形。
  名札 0x0201a87c（蘇る逆転 0x0201abb4）: data.bin 0xef78（英語 0x14778）+ (n // 5) * 0x800 + (n % 5) * 0xc0。
    パレットは文字の枠のもの 0xdad8（0x0202ae3c で BG パレット 0 へ）。名前の番号がそのまま絵の番号（55 個）。
  文字送りの音: 0x0208c6d4[名前]（音の番号は蘇る逆転と同じ 0x2d / 0x2e / 0x44。0x02025504 の関数）。
  法廷記録の表 0x0208cd5c（0x18 バイト × 156 個。155 は +16 より後ろが表の外と重なる）。欄は蘇る逆転と同じ
    （+0 アイコン, +2 名前（日本語）, +4 名前（英語）, +6 説明文, +8 = +6, +10 詳しく調べる絵）。上画面の窓 0x0203166c。
  アイコン 0x871c4（英語 0xbd724）+ アイコン * 0x820。名前のパック 0x78ab8（英語 0x7fdd0）、パレット 0x78a98。
  説明文のパック 0x2dcf8（英語 0x57a48）、パレット 0x2dcd8。
  話ごとの最初の法廷記録: 0x02095804[パートの番号 game+0x85]（0x02032a50。22 個）。

逆転裁判3（YG3J）:
  名札 0x02020d4c: 名前の番号 n を表 0x020ad728（u32 × 67）で絵の番号に直す。0x31 は名札を消して枠だけにする
    （0x02020f2c）。英語で絵の番号が 0x1a のときは、フラグ 0:0xf8 が立っていなければ 0x32 の絵にする。
    絵の場所 = 言語ごとの位置 0x020a64ac[0x020a64a4[game+4]]（日本語 0x9360、英語 0xe360）+ 蘇る逆転と同じ並び。
    パレット 0x7ec0（0x0202d2b0）。台本の命令 14（0x0202ca18）は、パート 10 より前でフラグ 0:0x8f が無ければ名前 21 を 2 にする。
  文字送りの音: 0x020a3b7c[名前]（音の番号は同じ。0x02025068 の関数）。
  法廷記録の表 0x020a43e4（0x18 バイト × 211 個。210 は +20 より後ろが表の外）。上画面の窓 0x02033ac0:
    +0 アイコン, +2 = +4 名前（窓は両言語とも +4）, +6 説明文（+8 = +6）, +10 詳しく調べる絵,
    +14 言語ごとのアイコン（0xff 以外なら アイコン 0x7c + 2 × 値 + 言語（日本語 0・英語 1）を使う）。
    言語ごとの場所は 0x20 バイトの組 0x020a653c + 0x20 × 0x020a64a4[game+4]（日本語 0x020a653c、英語 0x020a655c）:
    +0 アイコン（両言語とも 0xad55e0）, +0xc 名前のパック（0xbd0d00 / 0xd106f0）, +0x14 説明文のパック（0xbda04c / 0xd18e28）。
    パレットは説明文 0xad55a0、名前 0xad55c0。
  話ごとの最初の法廷記録: 0x020ae758[パートの番号 game+0x85]（0x020322b0。23 個）。パート p の最初の台本の項目は
    2 × 0x020a3cc0[p] なので、evidence.json の start の part はその半分（台本の番号 >> 1）にし、game_part に p を残す。
"""
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Layout:
    code: str
    #: 名札の絵の場所（言語 → data.bin）、パレット、言語ごとの絵の数
    nametag: dict
    nametag_pal: int
    nametag_count: dict
    #: 名前の番号 → 絵の番号の表（ARM9。無ければ同じ番号）と名前の数
    name_map: int | None
    name_count: int
    blip_table: int
    #: 法廷記録
    rec_table: int
    rec_count: int
    icon: dict
    icon_count: int
    name_pack: dict
    name_pal: int
    desc_pack: dict
    desc_pal: int
    start_table: int
    start_count: int
    rec_size: int = 0x18
    #: 言語ごとのアイコンの欄（+14。0xff なら無し）とその始まりの番号（3 だけ）
    icon_alt: int | None = None
    #: パートの番号 → 最初の台本の項目の半分（3 だけ。0x020a3cc0）
    part_first: tuple = field(default_factory=tuple)
    #: 名前の番号の表で「名札を消す」値、英語で差し替える絵（元の絵, 差し替え, フラグ）
    name_none: int | None = None
    name_en_swap: tuple | None = None


LAYOUTS = {
    'AGYJ': Layout(
        'AGYJ', {'ja': 0x1a81c54, 'en': 0x1a87454}, 0x1a807b4, {'ja': 55, 'en': 55}, None, 55, 0x020aabc0,
        0x020ab27c, 209, {'ja': 0x1b1dbb4, 'en': 0x1b68614}, (0x1b68614 - 0x1b1dbb4) // 0x820,
        {'ja': 0x1b0b10c, 'en': 0x1b14878}, 0x1b0b0ec, {'ja': 0x1ab13d4, 'en': 0x1ae2ea4}, 0x1ab13b4,
        0x020b4554, 35),
    'A2GJ': Layout(
        'A2GJ', {'ja': 0xef78, 'en': 0x14778}, 0xdad8, {'ja': 55, 'en': 55}, None, 55, 0x0208c6d4,
        0x0208cd5c, 156, {'ja': 0x871c4, 'en': 0xbd724}, (0xbd724 - 0x871c4) // 0x820,
        {'ja': 0x78ab8, 'en': 0x7fdd0}, 0x78a98, {'ja': 0x2dcf8, 'en': 0x57a48}, 0x2dcd8,
        0x02095804, 22),
    'YG3J': Layout(
        'YG3J', {'ja': 0x9360, 'en': 0xe360}, 0x7ec0, {'ja': 50, 'en': 51}, 0x020ad728, 67, 0x020a3b7c,
        0x020a43e4, 211, {'ja': 0xad55e0, 'en': 0xad55e0}, (0xb28a60 - 0xad55e0) // 0x820,
        {'ja': 0xbd0d00, 'en': 0xd106f0}, 0xad55c0, {'ja': 0xbda04c, 'en': 0xd18e28}, 0xad55a0,
        0x020ae758, 23, icon_alt=0x7c,
        part_first=(0, 1, 3, 5, 7, 10, 11, 13, 15, 17, 20, 21, 23, 25, 27, 28, 30, 31, 32, 34, 36, 38, 39),
        name_none=0x31, name_en_swap=(0x1a, 0x32, (0, 0xf8))),
}
