# /// script
# requires-python = ">=3.11"
# dependencies = ["capstone>=5"]
# ///
"""探偵パートの「パートごとのコード」を記号的に実行して、条件（フラグ）と動作の組に直す（tbl_invest.py から使う）。

ARM9 には、場所に着いたとき（0x020b466c[パート]）と、探偵パートの毎フレーム（0x020b46f8[パート]）に呼ばれる
パートごとの関数がある。中身は「今の場所で分岐 → フラグ（組 0）を調べて分岐 → 区画を走らせる・人物を出す・
音楽を鳴らす・調べる場所の表を写す」という決まった形なので、次のように読む:

- r0 = ゲーム全体の状態の構造体（0x020ceda8）。+0x68 = 今の場所、+0x69 = パートの番号（どちらも具体的な値で実行する）
- bl 0x0201a144(組, 番号) = フラグを調べる → 戻り値を記号にして、後の cmp で道を 2 つに分ける
- ほかの bl は「動作」として引数（r0〜r3 の値）を記録する（名前は CALLS）
- 分岐の条件がすべて具体的な値なら、そのとおりに進む

結果は「道」の一覧: {'cond': [((組, フラグ番号), 0/1) か ('lang', 'ja'/'en'), ...], 'acts': [(動作の名前, 引数...), ...]}。
"""
import re

from arm9 import Arm9

GAME = 0x020ceda8

#: 動作として記録する関数（番地 → 名前）。意味はコードから（tbl_invest.py の先頭の説明も参照）
CALLS = {
    0x0202887c: 'event',        # (区画, フラグ): フラグ(組 0)を立て、区画へ飛び、文字の枠を 3 にし、音楽を止める（着いたときの出来事）
    0x02028850: 'event_keep_bgm',  # (区画, フラグ): 同上。音楽を止めない版
    0x020288ac: 'char',         # (人物, 話す動き, 黙る動き): 人物を出す（game+0x6c/0x6e に動きを記録）
    0x02025878: 'bgm',          # (番号): 音楽を鳴らす
    0x020258f8: 'se',           # (番号): 効果音
    0x02007498: 'copy',         # (元, 先, 大きさ): メモリの写し。先 = 0x020ceb28 なら調べる場所の表
    0x0200744c: 'fill',         # (値, 先, 大きさ)
    0x0201a170: 'set_flag',     # (組, 番号, 値)
    0x0202232c: 'op_2232c',     # (番号): 0x020221b0(番号, 0)。人物・部品の表示に関わる（推測）
    0x0201ec34: 'bg_prepare',   # (0x020ce300, 背景)
    0x0201e168: 'bg',           # (0x020ce300, 背景)
    0x0202578c: 'bgm_stop',     # (): 音楽を止める（game+0x32 = 0xff）
    0x0201cf10: 'bg',           # (0x020ce300, 背景): 背景を替える（0x8000 = 左右反転の版）
    0x02022530: 'char_raw',     # (人物, 0, 動き, 0): 人物を出す（0x020288ac の中身）
    0x02036410: 'ui_36410',     # (0x020ce1c4, 15, 1): 下の画面の部品の設定
    0x02023960: 'load_part',    # (パート): game+0x69 = パートにして、そのパートの台本の項目を読み込む（第 5 話）
    0x020250d0: None,           # 今の文脈を返すだけ（記録しない）
}
#: 中に入って続けて実行する関数（第 5 話の「場所ごとに読み込む台本を切り替える」関数）
INLINE = {0x02068690, 0x02096a9c, 0x020973e0}
FLAG_TEST = 0x0201a144
COND = {'eq', 'ne', 'hs', 'cs', 'lo', 'cc', 'mi', 'pl', 'hi', 'ls', 'ge', 'lt', 'gt', 'le'}
REGS = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'sb', 'sl', 'fp', 'ip', 'sp', 'lr', 'pc']


def _cond_true(c: str, a: int, b: int) -> bool:
    """符号なし・符号付きの比較（値は 32 ビットに収まるものとする）"""
    ua, ub = a & 0xffffffff, b & 0xffffffff
    sa = ua - (1 << 32) if ua & 0x80000000 else ua
    sb = ub - (1 << 32) if ub & 0x80000000 else ub
    return {
        'eq': ua == ub, 'ne': ua != ub, 'hs': ua >= ub, 'cs': ua >= ub, 'lo': ua < ub, 'cc': ua < ub,
        'hi': ua > ub, 'ls': ua <= ub, 'ge': sa >= sb, 'lt': sa < sb, 'gt': sa > sb, 'le': sa <= sb,
        'mi': ((ua - ub) & 0x80000000) != 0, 'pl': ((ua - ub) & 0x80000000) == 0,
    }[c]


def _split(mn: str) -> tuple[str, str]:
    """'addls' → ('add', 'ls')、'popeq' → ('pop', 'eq')、'bls' → ('b', 'ls')"""
    for base in ('ldrb', 'ldrh', 'ldrsh', 'ldrsb', 'strb', 'strh', 'ldm', 'stm', 'movs', 'ands', 'subs', 'adds',
                 'push', 'pop', 'mov', 'mvn', 'ldr', 'str', 'add', 'sub', 'cmp', 'tst', 'and', 'orr', 'bic',
                 'lsl', 'lsr', 'bx', 'bl', 'b'):
        if mn.startswith(base):
            rest = mn[len(base):]
            if rest in COND:
                return base, rest
            if rest == '':
                return base, ''
            if base == 'ldm' or base == 'stm':
                return base, ''
    return mn, ''


def _imm(s: str) -> int:
    return int(s.strip().lstrip('#'), 0)


class Path:
    def __init__(self, regs, cond, acts, flags, part=0, stack=None):
        self.regs, self.cond, self.acts, self.flags = regs, cond, acts, flags
        self.part, self.stack = part, stack or []
        self.cmp = None  # (値a, 値b)。値は int か ('flag', 組, 番号) か None（不明）

    def fork(self):
        p = Path(dict(self.regs), list(self.cond), list(self.acts), dict(self.flags), self.part, list(self.stack))
        p.cmp = self.cmp
        return p


def run(a9: Arm9, func: int, place: int, part: int, max_steps: int = 4000) -> list[dict]:
    """func を place / part の具体的な値で記号的に実行し、道の一覧を返す"""
    done: list[dict] = []
    work = [(func, Path({'r0': 'game'}, [], [], {}, part))]
    while work:
        pc, p = work.pop()
        steps = 0
        while True:
            steps += 1
            if steps > max_steps:
                p.acts.append(('too_long', pc))
                done.append(p)
                break
            line = a9.disasm(pc, 1)[0]
            m = re.match(r'([0-9a-f]+): (\S+)\s*(.*?)(\s+;.*)?$', line)
            mn, ops = m.group(2), m.group(3)
            if mn == '.word':
                p.acts.append(('bad', pc))
                done.append(p)
                break
            base, cc = _split(mn)
            nxt = pc + 4
            if cc:
                r = _decide(p, cc)
                if r is None:
                    # 条件が記号 → 2 つの道に分ける
                    q = p.fork()
                    _constrain(p, cc, True)
                    _constrain(q, cc, False)
                    work.append((nxt, q))
                elif not r:
                    pc = nxt
                    continue
            res = _step(a9, p, pc, base, ops, place)
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
                if res[0] == 'fork':
                    # 表による分岐（addls pc, pc, rX, lsl #2）で値が不明
                    p.acts.append(('unknown_switch', pc))
                    done.append(p)
                    break
            pc = nxt
    return [{'cond': p.cond, 'acts': p.acts} for p in done]


def _val(p: Path, s: str):
    s = s.strip()
    if s.startswith('#'):
        return _imm(s)
    return p.regs.get(s)


def _decide(p: Path, cc: str):
    if p.cmp is None:
        return None
    a, b = p.cmp
    if isinstance(a, int) and isinstance(b, int):
        return _cond_true(cc, a, b)
    return None


def _constrain(p: Path, cc: str, truth: bool) -> None:
    a, b = p.cmp if p.cmp else (None, None)
    if isinstance(a, tuple) and a[0] == 'flag' and b == 0 and cc in ('eq', 'ne'):
        v = 0 if (cc == 'eq') == truth else 1
        p.cond.append((a[1], v))
        p.flags[a[1]] = v
        p.cmp = (v, 0)
        return
    if a == ('game', 4) and b == 1 and cc in ('eq', 'ne'):
        # game+4 = 1 のとき英語
        p.cond.append(('lang', 'en' if (cc == 'eq') == truth else 'ja'))
        p.cmp = (1 if (cc == 'eq') == truth else 0, 1)
        return
    p.cond.append((f'{a} {cc} {b}', truth))


def _step(a9: Arm9, p: Path, pc: int, base: str, ops: str, place: int):
    R = p.regs
    if base in ('push', 'stm', 'str', 'strb', 'strh', 'cmn', 'tst', 'nop'):
        return None
    if base in ('bx',):
        if ops.strip() == 'lr':
            return 'ret'
        return ('fork',)
    if base in ('pop', 'ldm'):
        return 'ret' if 'pc' in ops else None
    if base == 'b':
        return ('jump', _imm(ops))
    if base == 'bl':
        tgt = _imm(ops)
        args = [R.get('r0'), R.get('r1'), R.get('r2'), R.get('r3')]
        if tgt in INLINE:
            return ('call', tgt)
        if tgt == FLAG_TEST and isinstance(args[0], int) and isinstance(args[1], int):
            fl = (args[0], args[1])
            R['r0'] = p.flags[fl] if fl in p.flags else ('flag', fl)
        elif tgt in CALLS and CALLS[tgt] is None:
            R['r0'] = None
        else:
            name = CALLS.get(tgt, f'call_{tgt:08x}')
            p.acts.append((name, *[a if isinstance(a, int) else None for a in args]))
            if tgt == 0x0201a170 and None not in args[:3]:
                p.flags[(args[0], args[1])] = args[2]
            if tgt == 0x02023960 and isinstance(args[0], int):
                p.part = args[0]
            R['r0'] = None
        for r in ('r1', 'r2', 'r3', 'ip', 'lr'):
            R[r] = None
        return None
    parts = [x.strip() for x in re.split(r',(?![^\[]*\])', ops)]
    if base in ('mov', 'movs', 'mvn'):
        v = _val(p, parts[1]) if len(parts) == 2 else None
        if base == 'mvn' and isinstance(v, int):
            v = ~v & 0xffffffff
        if parts[0] == 'pc':
            return ('fork',)
        R[parts[0]] = v
        if base == 'movs':
            p.cmp = (v, 0)
        return None
    if base == 'ldr' and '[pc' in ops:
        imm = int(ops.split('#')[-1].rstrip(']'), 0) if '#' in ops else 0
        R[parts[0]] = a9.u32(((pc + 8) & ~3) + imm)
        if R[parts[0]] == GAME:
            R[parts[0]] = 'game'
        return None
    if base.startswith('ldr'):
        mm = re.match(r'\[(\w+)(?:, #(-?0x[0-9a-f]+|-?\d+))?\]', parts[1])
        v = None
        if mm and R.get(mm.group(1)) == 'game':
            off = int(mm.group(2), 0) if mm.group(2) else 0
            v = place if off == 0x68 else p.part if off == 0x69 else ('game', off)
        R[parts[0]] = v
        return None
    if base == 'cmp':
        p.cmp = (_val(p, parts[0]), _val(p, parts[1]))
        return None
    if base in ('add', 'sub', 'adds', 'subs', 'and', 'ands', 'orr', 'bic', 'lsl', 'lsr'):
        if parts[0] == 'pc':
            # addls pc, pc, rX, lsl #2: 表による分岐。rX が具体的なら飛び先を計算
            rx = _val(p, parts[2])
            if isinstance(rx, int):
                return ('jump', pc + 8 + rx * 4)
            return ('fork',)
        a = _val(p, parts[1]) if len(parts) > 1 else None
        b = _val(p, parts[2]) if len(parts) > 2 else None
        v = None
        if isinstance(a, int) and isinstance(b, int):
            op = base.rstrip('s') if base in ('adds', 'subs', 'ands') else base
            v = {'add': a + b, 'sub': a - b, 'and': a & b, 'orr': a | b, 'bic': a & ~b,
                 'lsl': a << b, 'lsr': a >> b}[op] & 0xffffffff
        R[parts[0]] = v
        if base in ('adds', 'subs', 'ands'):
            p.cmp = (v, 0)
        return None
    # そのほか（mul など）は結果を不明にする
    if parts:
        R[parts[0]] = None
    return None
