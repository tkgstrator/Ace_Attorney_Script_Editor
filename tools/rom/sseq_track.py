"""SSEQ のトラック（1 本の命令の列）。命令の一覧は sseq_player.py の先頭を参照。

乱数（A0）・変数（A1）・条件（A2）は、次の命令の最後の引数を置き換える / 次の命令を飛ばす。
乱数は SDK と同じ線形合同法（x·1664525 + 1013904223）だが、実機の種は分からないので、
乱数を使う曲は実機と同じにはならない。
"""
from nds_sound_tables import cnv_sust
from sseq_channel import NONE, Channel

# 引数の種類: b = u8, s = s8, h = s16, H = u16, t = u24, v = 可変長
ARGS = {0x80: 'v', 0x81: 'v', 0x93: 'bt', 0x94: 't', 0x95: 't', 0xC3: 's', 0xC4: 's',
        0xE0: 'H', 0xE1: 'H', 0xE3: 'h', 0xFC: '', 0xFD: '', 0xFE: 'H', 0xFF: ''}
for _c in range(0xB0, 0xBE):
    ARGS[_c] = 'bh'
for _c in list(range(0xC0, 0xD7)):
    ARGS.setdefault(_c, 'b')



class Track:
    def __init__(self, player, no: int, pos: int):
        self.player = player
        self.no = no
        self.pos = pos
        self.stack: list[tuple[int, int]] = []     # (戻る位置, ループの残り回数 または -1 = call)
        self.wait = 0
        self.end = False
        self.patch = 0
        self.pan = 0
        self.vol = 127
        self.expr = 127
        self.bend = 0
        self.bend_range = 2
        self.transpose = 0
        self.prio = player.prio + 64
        self.note_wait = True
        self.tie = False
        self.tie_channel: Channel | None = None
        self.porta = False
        self.porta_key = 60
        self.porta_time = 0
        self.sweep_pitch = 0
        self.a = self.d = self.s = self.r = 0xFF
        self.mod_type = 0
        self.mod_speed = 16
        self.mod_depth = 0
        self.mod_range = 1
        self.mod_delay = 0
        self.cond = True
        self.visited: dict[int, int] = {}          # ジャンプ先 → 最初に来たティック

    # --- 読み出し ---
    def _u8(self) -> int:
        b = self.player.data[self.pos]
        self.pos += 1
        return b

    def _arg(self, t: str) -> int:
        d = self.player.data
        if t == 'b':
            return self._u8()
        if t == 's':
            v = self._u8()
            return v - 256 if v >= 128 else v
        if t in 'hH':
            v = d[self.pos] | d[self.pos + 1] << 8
            self.pos += 2
            return v - 0x10000 if t == 'h' and v >= 0x8000 else v
        if t == 't':
            v = d[self.pos] | d[self.pos + 1] << 8 | d[self.pos + 2] << 16
            self.pos += 3
            return v
        v = 0                                       # 可変長
        while True:
            b = self._u8()
            v = (v << 7) | (b & 0x7F)
            if not b & 0x80:
                return v

    def _args(self, types: str, mode: str) -> list[int]:
        """引数を読む。mode が 'rand' / 'var' なら最後の引数を乱数 / 変数に置き換える"""
        out = [self._arg(t) for t in types[:-1]]
        if types:
            if mode == 'rand':
                lo, hi = self._arg('h'), self._arg('h')
                out.append(lo + ((self.player.random() * (hi - lo + 1)) >> 16))
            elif mode == 'var':
                out.append(self.player.var_get(self._u8()))
            else:
                out.append(self._arg(types[-1]))
        return out

    # --- 1 ティック ---
    def tick(self):
        if self.end:
            return
        if self.wait > 0:
            self.wait -= 1
            if self.wait > 0:
                return
        guard = 0
        while self.wait == 0 and not self.end:
            guard += 1
            if guard > 10000:           # 待たずに回り続ける列（壊れたデータ）
                self.finish()
                return
            self.step()

    def step(self, mode: str = '', skip: bool = False):
        cmd = self._u8()
        if cmd == 0xA0:
            return self.step('rand', skip)
        if cmd == 0xA1:
            return self.step('var', skip)
        if cmd == 0xA2:
            return self.step(mode, skip or not self.cond)
        if cmd < 0x80:
            vel, length = self._args('bv', mode)
            if not skip:
                self.note(cmd, vel, length)
            return
        types = ARGS.get(cmd)
        if types is None:
            self.finish()               # 知らない命令: 止める
            return
        a = self._args(types, mode)
        if skip:
            return
        self.execute(cmd, a)

    def execute(self, cmd: int, a: list[int]):
        p = self.player
        if cmd == 0x80:
            self.wait = a[0]
        elif cmd == 0x81:
            self.patch = a[0]
        elif cmd == 0x93:
            p.open_track(a[0], a[1])
        elif cmd == 0x94:
            self.jump(a[0])
        elif cmd == 0x95:
            self.stack.append((self.pos, -1))
            self.pos = p.base + a[0]
        elif cmd == 0xFD:
            if self.stack:
                self.pos = self.stack.pop()[0]
        elif cmd == 0xD4:
            self.stack.append((self.pos, a[0]))
        elif cmd == 0xFC:
            if self.stack:
                ret, cnt = self.stack[-1]
                if cnt == 0:                        # 回数 0 = 無限
                    p.loop_event(self, ret)
                    self.pos = ret
                elif cnt > 1:
                    self.stack[-1] = (ret, cnt - 1)
                    self.pos = ret
                else:
                    self.stack.pop()
        elif cmd == 0xFF:
            self.finish()
        elif cmd == 0xFE:
            pass
        elif 0xB0 <= cmd <= 0xBD:
            self.var_op(cmd, a[0], a[1])
        elif cmd == 0xC0:
            self.pan = a[0] - 64
        elif cmd == 0xC1:
            self.vol = a[0]
        elif cmd == 0xC2:
            p.master_vol = cnv_sust(a[0])
        elif cmd == 0xC3:
            self.transpose = a[0]
        elif cmd == 0xC4:
            self.bend = a[0]
        elif cmd == 0xC5:
            self.bend_range = a[0]
        elif cmd == 0xC6:
            self.prio = p.prio + a[0]
        elif cmd == 0xC7:
            self.note_wait = bool(a[0])
        elif cmd == 0xC8:
            self.tie = bool(a[0])
            p.release_track(self)
            self.tie_channel = None
        elif cmd == 0xC9:
            self.porta_key = a[0] + self.transpose
            self.porta = True
        elif cmd == 0xCA:
            self.mod_depth = a[0]
        elif cmd == 0xCB:
            self.mod_speed = a[0]
        elif cmd == 0xCC:
            self.mod_type = a[0]
        elif cmd == 0xCD:
            self.mod_range = a[0]
        elif cmd == 0xCE:
            self.porta = bool(a[0])
        elif cmd == 0xCF:
            self.porta_time = a[0]
        elif cmd == 0xD0:
            self.a = a[0]
        elif cmd == 0xD1:
            self.d = a[0]
        elif cmd == 0xD2:
            self.s = a[0]
        elif cmd == 0xD3:
            self.r = a[0]
        elif cmd == 0xD5:
            self.expr = a[0]
        elif cmd == 0xE0:
            self.mod_delay = a[0]
        elif cmd == 0xE1:
            p.tempo = a[0]
        elif cmd == 0xE3:
            self.sweep_pitch = a[0]

    def jump(self, ofs: int):
        target = self.player.base + ofs
        if target <= self.pos:
            self.player.loop_event(self, target)
        self.pos = target

    def finish(self):
        self.end = True
        self.player.release_track(self)

    def var_op(self, cmd: int, idx: int, val: int):
        p = self.player
        cur = p.var_get(idx)
        if cmd == 0xB0:
            p.var_set(idx, val)
        elif cmd == 0xB1:
            p.var_set(idx, cur + val)
        elif cmd == 0xB2:
            p.var_set(idx, cur - val)
        elif cmd == 0xB3:
            p.var_set(idx, cur * val)
        elif cmd == 0xB4:
            if val:
                p.var_set(idx, int(cur / val))
        elif cmd == 0xB5:
            p.var_set(idx, cur << val if val >= 0 else cur >> -val)
        elif cmd == 0xB6:
            r = (p.random() * (abs(val) + 1)) >> 16
            p.var_set(idx, -r if val < 0 else r)
        elif cmd >= 0xB8:
            self.cond = {0xB8: cur == val, 0xB9: cur >= val, 0xBA: cur > val,
                         0xBB: cur <= val, 0xBC: cur < val, 0xBD: cur != val}[cmd]

    def note(self, key: int, vel: int, length: int):
        key = min(max(key + self.transpose, 0), 127)
        p = self.player
        ch = None
        if self.tie:
            ch = self.tie_channel
            if ch is not None and ch.state != NONE and ch.track is self:
                ch.key = key
                ch.velocity = cnv_sust(vel)
                ch.update_from_track(self, p)
                ch.start_porta(self)
            else:
                self.tie_channel = p.note_on(self, key, vel, -1)
        else:
            p.note_on(self, key, vel, length)
        self.porta_key = key
        if self.note_wait:
            self.wait = length
