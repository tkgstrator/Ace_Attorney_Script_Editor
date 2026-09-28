"""どのゲームの ROM かを見分け、ゲームごとの置き場所・命令の表を返す。

    from game import detect
    g = detect(rom)          # ROM の見出しのゲームコード（0x0c）で判定
    g.out                    # 抽出物の置き場所（蘇る逆転 = assets/extracted、2 = assets/extracted/aa2、3 = assets/extracted/aa3）
    g.argc                   # 台本の命令の引数の数
    uv run tools/rom/game.py <rom.nds>   # ゲームコード・版・SHA-1 と、確かめた ROM と同じかを出す

扱うゲーム:
  AGYJ 逆転裁判 蘇る逆転（基準。tables/README.md の番地はすべてこれ）
  A2GJ 逆転裁判2（DS 版）: 命令の関数の表 ARM9 0x020954b4（128 個）
  YG3J 逆転裁判3（DS 版）: 命令の関数の表 ARM9 0x020adeb0（128 個。解釈ループ 0x020250c4 で r8 に読む）

2・3 の命令の引数の数（tools/rom/op_args23.py で確かめられる）:
  - 0〜78 は蘇る逆転と同じ（関数の中身も同じ形）。
  - 79〜127 は 2・3 で使い方が違う。関数を 1 つずつ動かして（unicorn）、読む位置（文脈 +0x0c）を進めた量から求めた。
    止まる（1 を返して進めない）関数は逆アセンブルで読んだ（85: +6 = 2 個、124: 2 は +2 = 0 個）。
  - 全項目をこの表で読むと、2・3 とも全区画が 13（end）で終わる（3 の分割された項目の古い見出しは除く。script_json.py）。
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
    # 52（セーブの画面を待つ）は次の語を場所の番号として読む。セーブの画面が終わると、探偵パートでは台本の読む位置を
    # 2 語進めて game+0x84 = その語にし、場所へ移る状態（0x504）にする（A2GJ 0x0204d8a8・YG3J 0x0204f88c / 0x0204ba84）
    52: 1,
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


#: 確かめた ROM（ゲームコード → 見出しの版（0x1e）と SHA-1）。ARM9 の表の番地（tbl_*.py・game_assets.py など）は
#: この版で調べたもの。rom = ファイル全体、arm9 = ARM9 の本体（末尾を詰めた ROM でも変わらない）
KNOWN_ROMS = {
    'AGYJ': {'revision': 0, 'rom_sha1': '056070f41424f4a7f1613edcc97f4118db01c186',
             'arm9_sha1': '2ac753b6275d50a3423011b8a696d22088b47acf'},
    'A2GJ': {'revision': 0, 'rom_sha1': 'ff3050bb135882b37b40de8c6098766485c98c18',
             'arm9_sha1': 'dfdfd4ce97e47e76bf19e9af0997a3de80b24824'},
    'YG3J': {'revision': 0, 'rom_sha1': '4e894118102f44a7e07084a5c518765629ef1d5d',
             'arm9_sha1': '8a7dad6a532f38f23b331b32d6bc592f8ad77e40'},
}
_checked: set[str] = set()


def check_rom(rom: bytes) -> list[str]:
    """ROM が確かめた版かを調べ、違えば警告の文の一覧を返す。
    ARM9 が同じなら表の番地は同じなので、ファイル全体の SHA-1 が違うだけ（末尾を詰めた ROM など）なら警告しない"""
    import hashlib
    from nds import arm9
    code = code_of(rom)
    known = KNOWN_ROMS.get(code)
    if known is None:
        return [f'確かめていないゲームコードです: {code}']
    if hashlib.sha1(rom).hexdigest() == known['rom_sha1']:
        return []
    out = []
    rev = rom[0x1e]
    if rev != known['revision']:
        out.append(f'{code}: 見出しの版が {rev} です（確かめたのは {known["revision"]}）')
    if hashlib.sha1(arm9(rom)).hexdigest() != known['arm9_sha1']:
        out.append(f'{code}: ARM9 が確かめた ROM と違います。表の番地（tools/rom の tbl_*.py など）がずれている'
                   'かもしれないので、抽出した表を確かめてください')
    return out


def code_of(rom: bytes) -> str:
    return rom[0x0c:0x10].decode('ascii')


def detect(rom: bytes) -> Game:
    """ROM の見出しのゲームコードで見分ける（知らないものは蘇る逆転として扱わず、止める）"""
    c = code_of(rom)
    if c not in GAMES:
        raise SystemExit(f'知らないゲームコードです: {c}（{", ".join(GAMES)} のどれか）')
    # ROM 全体を渡されたときは版も確かめる（見出しだけのときは確かめない）
    # （1 つのゲームにつき 1 回、標準エラーに出す）
    if len(rom) > 0x4000 and c not in _checked:
        _checked.add(c)
        for w in check_rom(rom):
            print(f'警告: {w}', file=sys.stderr)
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


def main() -> None:
    import hashlib
    from nds import arm9
    if len(sys.argv) != 2:
        sys.exit('使い方: uv run tools/rom/game.py <rom.nds>')
    rom = Path(sys.argv[1]).read_bytes()
    code = code_of(rom)
    print(f'ゲームコード {code}、版 {rom[0x1e]}、大きさ {len(rom)}')
    print(f'SHA-1 {hashlib.sha1(rom).hexdigest()}（ARM9 {hashlib.sha1(arm9(rom)).hexdigest()}）')
    warns = check_rom(rom)
    for w in warns:
        print(f'警告: {w}')
    print('確かめた ROM と同じです' if not warns else '確かめた ROM と違います')


if __name__ == '__main__':
    main()
