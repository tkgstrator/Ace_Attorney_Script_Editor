# /// script
# requires-python = ">=3.11"
# dependencies = ["capstone>=5"]
# ///
"""「3D で詳しく調べる」の結果の関数（0x020c0704[結果の番号]）を記号的に実行する（tbl_examine3d.py から使う）。

tbl_invest_sym.py の実行器に「決まった番地への書き込み（str/strb/strh [rX]）」の記録を足したもの。
結果の関数は、どれも次の決まった形をしている:

- 0x023162dc ← 走らせる区画（+128。0 なら台詞なし）
- 0x02316250 ← 次に見せる 3D の物（0x020b93d8 の番号。例: 携帯電話を開いた形）
- 0x02316290 / 0x02316270 / 0x02316268 ← 物の向き（度）、0x02316298 / 0x02316278 / 0x02316280 ← 位置
- bl 0x02023960(0xffff) = 台本の項目 070（3D で調べるときの台詞）を読み込む。呼ばなければ話の台本の区画
- bl 0x0201a144(組, 番号) = フラグを調べる / bl 0x0201a170(組, 番号, 値) = フラグを立てる
- ldrb [game+0x69] = パート（具体的な値で実行する）
"""
import re

import tbl_invest_sym as sym
from arm9 import Arm9

#: 書き込みを記録する番地 → 名前
STORES = {
    0x023162dc: 'section', 0x02316250: 'object',
    0x02316290: 'rot_a', 0x02316270: 'rot_b', 0x02316268: 'rot_c',
    0x02316298: 'pos_a', 0x02316278: 'pos_b', 0x02316280: 'pos_c',
}
#: 動作として記録する関数（tbl_invest_sym.CALLS に足す）
CALLS = {
    0x0203e9b4: 'load_object',  # (物): 物のテクスチャなどを読み込む（0x020b93d8 + 物 × 0x1c）
    0x0203e074: None, 0x020074ec: None,  # 行列・領域の初期化（記録しない）
}


def run(a9: Arm9, func: int, part: int, max_steps: int = 3000) -> list[dict]:
    """func をパート part で記号的に実行し、道の一覧 {'cond': [...], 'acts': [...]} を返す"""
    done: list[sym.Path] = []
    work = [(func, sym.Path({'r0': None}, [], [], {}, part))]
    saved = dict(sym.CALLS)
    sym.CALLS.update(CALLS)
    try:
        while work:
            pc, p = work.pop()
            for _ in range(max_steps):
                line = a9.disasm(pc, 1)[0]
                m = re.match(r'([0-9a-f]+): (\S+)\s*(.*?)(\s+;.*)?$', line)
                mn, ops = m.group(2), m.group(3)
                if mn == '.word':
                    p.acts.append(('bad', pc))
                    done.append(p)
                    break
                base, cc = sym._split(mn)
                nxt = pc + 4
                if cc:
                    r = sym._decide(p, cc)
                    if r is None:
                        q = p.fork()
                        sym._constrain(p, cc, True)
                        sym._constrain(q, cc, False)
                        work.append((nxt, q))
                    elif not r:
                        pc = nxt
                        continue
                if base in ('str', 'strb', 'strh'):
                    _store(p, ops)
                res = sym._step(a9, p, pc, base, ops, 0)
                if res == 'ret':
                    if p.stack:
                        pc = p.stack.pop()
                        continue
                    done.append(p)
                    break
                if isinstance(res, tuple):
                    if res[0] == 'jump':
                        pc = res[1]
                        continue
                    if res[0] == 'call':
                        p.stack.append(nxt)
                        pc = res[1]
                        continue
                    p.acts.append(('unknown_switch', pc))
                    done.append(p)
                    break
                pc = nxt
            else:
                p.acts.append(('too_long', pc))
                done.append(p)
    finally:
        sym.CALLS.clear()
        sym.CALLS.update(saved)
    return [{'cond': p.cond, 'acts': p.acts} for p in done]


def _store(p: 'sym.Path', ops: str) -> None:
    """str rX, [rY] / [rY, #n] で、rY が決まった番地なら (名前, 値) を記録する"""
    m = re.match(r'(\w+), \[(\w+)(?:, #(-?0x[0-9a-f]+|-?\d+))?\]$', ops.strip())
    if not m:
        return
    addr = p.regs.get(m.group(2))
    if not isinstance(addr, int):
        return
    addr += int(m.group(3), 0) if m.group(3) else 0
    if addr in STORES:
        v = p.regs.get(m.group(1))
        p.acts.append(('store', STORES[addr], v if isinstance(v, int) else None))
