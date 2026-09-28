"""どのゲームの ROM かを見分け、ゲームごとの置き場所・命令の表を返す。

    from game import detect
    g = detect(rom)          # ROM の見出しのゲームコード（0x0c）で判定
    g.out                    # 抽出物の置き場所（蘇る逆転 = assets/extracted、2 = assets/extracted/aa2、3 = assets/extracted/aa3）
    g.argc                   # 台本の命令の引数の数

扱うゲーム:
  AGYJ 逆転裁判 蘇る逆転（基準。tables/README.md の番地はすべてこれ）
  A2GJ 逆転裁判2（DS 版）: 命令の関数の表 ARM9 0x020954b4（128 個）
  YG3J 逆転裁判3（DS 版）: 命令の関数の表 ARM9 0x020adeb0（128 個。解釈ループ 0x020250c4 で r8 に読む）

2・3 の命令の引数の数（tools/rom/op_args23.py で確かめられる）:
  - 0〜78 は蘇る逆転と同じ（関数の中身も同じ形）。
  - 79〜127 は 2・3 で使い方が違う。関数を 1 つずつ動かして（unicorn）、読む位置（文脈 +0x0c）を進めた量から求めた。
    止まる（1 を返して進めない）関数は逆アセンブルで読んだ（85: +6 = 2 個、124: 2 は +2 = 0 個）。
  - 全項目をこの表で読むと、2 は全区画が 13 で終わる。3 は区画の終わりが 13 でないものが 8 個（どれも 54 などで飛ぶ区画）。
"""
from __future__ import annotations

import os
import struct
import sys
from dataclasses import dataclass, field
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from script_format import ARGC as ARGC_AGYJ  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
EXTRACTED = ROOT / 'assets/extracted'

#: 2・3 で蘇る逆転と引数の数が違う命令（79 以降）
_ARGC_23 = {
    79: 7, 80: 1, 81: 2, 82: 1, 83: 0, 84: 2, 85: 2, 86: 0, 87: 1, 88: 0, 89: 1, 90: 1, 91: 2, 94: 0,
    96: 4, 97: 3, 98: 0, 99: 0, 100: 1, 102: 3, 103: 0, 108: 0, 109: 1, 110: 1, 112: 0, 113: 3,
    114: 0, 115: 0, 117: 0, 123: 0, 124: 0, 125: 1, 126: 1, 127: 0,
    # 106（パートを移る）は次の語をパートの番号として読むだけで進めない（蘇る逆転と同じ関数）。
    # 3 では次の語が 9 などの命令の番号と重なって読みがずれるので、2・3 では引数 1 個として読む
    106: 1,
}
ARGC_A2GJ = {**ARGC_AGYJ, **_ARGC_23}
#: 3 だけ違うもの（108 は 1 個、124〜126 は何もしない関数）
ARGC_YG3J = {**ARGC_A2GJ, 108: 1, 124: 0, 125: 0, 126: 0}


@dataclass(frozen=True)
class Game:
    code: str
    #: 短い名前（aa1 / aa2 / aa3）
    key: str
    title: str
    #: 抽出物の置き場所
    out: Path
    #: 台本の命令 → 引数の数
    argc: dict[int, int]
    #: 命令の関数の表（ARM9）
    op_table: int
    #: フォントの文字認識の結果（mapping.tsv）の場所と、手で直した表
    font_dir: Path
    font_fixes: Path
    #: 共通の台本（尋問の見当違いなど）の項目（日本語）
    common_item: int
    extra: dict = field(default_factory=dict)

    @property
    def tables(self) -> Path:
        return self.out / 'tables'

    @property
    def script(self) -> Path:
        return self.out / 'script'


GAMES = {
    'AGYJ': Game('AGYJ', 'aa1', '逆転裁判 蘇る逆転', EXTRACTED, ARGC_AGYJ, 0x020b41b8,
                 EXTRACTED / 'font', ROOT / 'tools/rom/font_fixes.tsv', 72),
    'A2GJ': Game('A2GJ', 'aa2', '逆転裁判2', EXTRACTED / 'aa2', ARGC_A2GJ, 0x020954b4,
                 EXTRACTED / 'font/A2GJ', ROOT / 'tools/rom/font_fixes.A2GJ.tsv', 44),
    'YG3J': Game('YG3J', 'aa3', '逆転裁判3', EXTRACTED / 'aa3', ARGC_YG3J, 0x020adeb0,
                 EXTRACTED / 'font/YG3J', ROOT / 'tools/rom/font_fixes.YG3J.tsv', 84),
}


def code_of(rom: bytes) -> str:
    return rom[0x0c:0x10].decode('ascii')


def detect(rom: bytes) -> Game:
    """ROM の見出しのゲームコードで見分ける（知らないものは蘇る逆転として扱わず、止める）"""
    c = code_of(rom)
    if c not in GAMES:
        raise SystemExit(f'知らないゲームコードです: {c}（{", ".join(GAMES)} のどれか）')
    return GAMES[c]


def detect_path(path: str) -> Game:
    """ROM のファイルから見分ける。mes_all.bin などを渡したときは蘇る逆転"""
    if not path.endswith('.nds'):
        return GAMES['AGYJ']
    with open(path, 'rb') as f:
        head = f.read(0x10)
    return detect(head)


def by_key(key: str) -> Game:
    for g in GAMES.values():
        if key in (g.key, g.code):
            return g
    raise SystemExit(f'知らないゲーム: {key}')


def rom_u32(rom: bytes, off: int) -> int:
    return struct.unpack_from('<I', rom, off)[0]
