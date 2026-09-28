# /// script
# requires-python = ">=3.11"
# dependencies = ["capstone>=5"]
# ///
"""探偵パートの最初の場所（game+0x68）を ARM9 から読む。

    uv run tools/rom/tbl_invest_start.py <rom.nds> [出力（<抽出物>/tables/invest_start.json）]

各パートの始めの関数（investigation.json の init.func、0x020b443c[パート]）は、場所・話題の表を写したあと
`mov r0, #N` → `strb r0, [r4, #0x68]` で最初の場所を決める（パート 1 = 0、パート 3 = 2 など）。
その N を {パート: 場所} にする。見つからなければ書かない。
2・3 も同じ形（今の場所は game+0x84）。investigation.json は同じゲームの抽出物の tables/ のものを読む（先に tbl_invest.py）。
"""
import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from arm9 import Arm9  # noqa: E402
from game import detect  # noqa: E402
from invest_addrs import BY_CODE  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def start_place(a9: Arm9, func: int, off: int = 0x68) -> int | None:
    last_mov: dict[str, int] = {}
    for line in a9.disasm(func, 80, stop_at_ret=True):
        m = re.search(r'mov\s+(r\d+), #(0x[0-9a-f]+|\d+)$', line)
        if m:
            last_mov[m.group(1)] = int(m.group(2), 0)
        m = re.search(rf'strb\s+(r\d+), \[r\d+, #{off:#x}\]', line)
        if m and m.group(1) in last_mov:
            return last_mov[m.group(1)]
    return None


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    rom = open(sys.argv[1], 'rb').read()
    game = detect(rom)
    off = BY_CODE[game.code].sym.off_place
    a9 = Arm9(rom)
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else game.tables / 'invest_start.json'
    inv = json.loads((game.tables / 'investigation.json').read_text(encoding='utf-8'))
    res = {}
    for p in inv['parts']:
        func = (p.get('init') or {}).get('func')
        if func:
            n = start_place(a9, int(func, 16), off)
            if n is not None:
                res[str(p['part'])] = n
    out.write_text(json.dumps({'_about': '探偵パートの最初の場所（game+0x68）。tools/rom/tbl_invest_start.py', 'start': res},
                              ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'{out}: {res}')


if __name__ == '__main__':
    main()
