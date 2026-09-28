"""素材の取り出しで使う、ゲームごとの ARM9 の表・data.bin の位置（蘇る逆転 AGYJ・2 A2GJ・3 YG3J）。

    from game_assets import assets_of
    A = assets_of(rom)        # ROM の見出しで見分ける（game.detect）
    A.bg_table, A.char_pack ...

2・3 の番地の見つけ方（確かめ方）:
  背景の表: 蘇る逆転の読み込み 0x0201ec34（0x020a7cb4 を [r5 << 4] で引く）と同じ形の関数を探した
    （2: 0x0201eb74 → 0x0208a2f4、3: 0x0201d1d4 → 0x0209fd60）。16 バイトの行（位置, 大きさ, フラグ, 英語の差し替え）。
    数は行が data.bin の中を指さなくなる所まで（2: 144 行、3: 180 行）。台本の 27 の番号はすべてこの中に入る。
  人物のパック: data.bin の中で (画像, 動き) の組が並ぶパック（tailfmt.is_char_pack）が 1 つだけある（2: 214 組、3: 252 組）。
  動きの番号の表: (u16 ファイル, u16 区間の位置) が並び、区間が u16 0 で始まる所がいちばん長く続く所。先頭は ARM9 の
    コードからの参照で決めた（2: 0x0208aee0 を 0x02022fa4 ほか 4 か所）。
    3 は人物を出す関数 0x020222a0（r0 = 人物、r1 = 動き）が、動きを 0x020a1908 / 0x020a190a（[動き << 2]）で
    (ファイル, 区間) に引き、人物を 0x020a1844（[人物 << 2]、49 人 × 4 バイト。部品の数の上限）で引く。
    以前は 0x020a1844 を動きの表の先頭としていたため、動きの番号が 49 ずれ、春美（人物 30）に御剣の絵が出ていた。
  47 anim: 蘇る逆転の 0x0202203c と同じ形の関数（2: 0x02022fc0、3: 0x0202257c）のリテラル。
    3 の (ファイル, 区間) の表は動きの番号の表と同じ（0x020a1908）。3 の差し替えの表 0x020ad86c は
    言語の添字（0x020a64a4[言語]、日本語 = 0）× 0x318 で選び、日本語でも +0x14 が 0xffff でなければ差し替える。
    数は行が正しく読める所まで（2: 158、3: 227。台本で使う番号の最大は 157・226）。
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from game import GAMES, Game, detect  # noqa: E402


@dataclass(frozen=True)
class Assets:
    game: Game
    #: 背景の表（ARM9）と行の数
    bg_table: int
    bg_count: int
    #: 人物のパック（data.bin の位置）
    char_pack: int
    #: 動きの番号 → (ファイル, 区間) の表（ARM9）と数、台本の 30 で使う範囲（1〜script_anims-1）
    anim_table: int
    anim_count: int
    script_anims: int
    #: 人物ごとの OAM の数の上限の表（蘇る逆転・3）
    char_table: int | None = None
    char_count: int = 0
    #: 人物のパックの数を持つ ARM9 の語（確かめ用）
    char_pack_count_word: int | None = None
    #: 47 anim の表（0x18 バイト × 数）、英語の差し替えの表、(ファイル, 区間) の表
    anims47_table: int = 0
    anims47_count: int = 0
    anims47_en: int = 0
    anims47_pairs: int = 0
    #: 3: 差し替えの表が言語ごと（+0x318 × 言語の添字）で、日本語でも差し替えを使う
    anims47_per_lang: int = 0

    @property
    def code(self) -> str:
        return self.game.code


ASSETS = {
    'AGYJ': Assets(GAMES['AGYJ'], 0x020a7cb4, 241, 0x2202220, 0x020a8f80, 704, 505,
                   0x020a8c20, 64, 0x020235a0, 0x020a9a80, 184, 0x020a8cf8, 0x020a8f80),
    'A2GJ': Assets(GAMES['A2GJ'], 0x0208a2f4, 144, 0x529934, 0x0208aee0, 585, 585,
                   anims47_table=0x0208b7ec, anims47_count=158, anims47_en=0x0208ace8, anims47_pairs=0x0208aee0),
    'YG3J': Assets(GAMES['YG3J'], 0x0209fd60, 180, 0x4bf528, 0x020a1908, 819, 819, 0x020a1844, 49,
                   anims47_table=0x020a25b4, anims47_count=227, anims47_en=0x020ad86c, anims47_pairs=0x020a1908,
                   anims47_per_lang=0x318),
}


def assets_of(rom: bytes) -> Assets:
    return ASSETS[detect(rom).code]
