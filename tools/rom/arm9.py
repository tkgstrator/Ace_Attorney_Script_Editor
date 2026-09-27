# /// script
# requires-python = ">=3.11"
# dependencies = ["capstone>=5"]
# ///
"""ARM9 のプログラムを読むための道具（逆アセンブル・参照の検索）。ROM は変更しない。

    uv run tools/rom/arm9.py <rom.nds> dis <番地> [命令の数] [--thumb]   # 逆アセンブル（定数の読み込みは値も表示）
    uv run tools/rom/arm9.py <rom.nds> func <番地> [--thumb]            # 関数の終わり（bx lr / pop pc）まで
    uv run tools/rom/arm9.py <rom.nds> xref <値>                        # その値を持つ 4 バイト境界の語
    uv run tools/rom/arm9.py <rom.nds> calls <番地>                     # その番地を bl / blx で呼ぶ所
    uv run tools/rom/arm9.py <rom.nds> words <番地> <個数>              # u32 を並べて表示
    uv run tools/rom/arm9.py <rom.nds> halves <番地> <個数>             # u16 を並べて表示

ARM9 は圧縮されておらず（モジュールの情報で compressed end = 0）、オーバーレイも無い。
0x020cb040 からの 0x14e0 バイトは ITCM（0x01ff8000）、続く 0xc60 バイトは DTCM（0x027c0000）へ
起動時に写される（autoload）。ここではそれらの番地でも読めるようにしてある。
"""
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from nds import arm9 as _arm9  # noqa: E402

BASE = 0x02000000


class Arm9:
    """ARM9 のメモリの見かけ（本体 + autoload の写し先）"""

    def __init__(self, rom: bytes):
        self.img = _arm9(rom)
        self.regions: list[tuple[int, bytes]] = [(BASE, self.img)]
        # autoload の一覧（本体の末尾近く、0x020cd180〜）
        src = 0x020cb040
        for i in range(2):
            dst, size, _bss = struct.unpack_from('<3I', self.img, 0xcd180 + i * 12)
            o = src - BASE
            self.regions.append((dst, self.img[o:o + size]))
            src += size

    def find(self, addr: int) -> tuple[bytes, int] | None:
        for base, data in self.regions:
            if base <= addr < base + len(data):
                return data, addr - base
        return None

    def read(self, addr: int, n: int) -> bytes:
        r = self.find(addr)
        if not r:
            raise ValueError(f'範囲外: {addr:#x}')
        data, o = r
        return data[o:o + n]

    def u32(self, addr: int) -> int:
        return struct.unpack('<I', self.read(addr, 4))[0]

    def u16(self, addr: int) -> int:
        return struct.unpack('<H', self.read(addr, 2))[0]

    def s16(self, addr: int) -> int:
        return struct.unpack('<h', self.read(addr, 2))[0]

    def u8(self, addr: int) -> int:
        return self.read(addr, 1)[0]

    def cstr(self, addr: int, enc: str = 'shift_jis') -> str:
        b = self.read(addr, 256)
        return b[:b.index(0)].decode(enc, 'replace') if 0 in b else b.decode(enc, 'replace')

    # ---- 逆アセンブル ----
    def disasm(self, addr: int, count: int = 64, thumb: bool = False, stop_at_ret: bool = False) -> list[str]:
        import capstone as cs
        md = cs.Cs(cs.CS_ARCH_ARM, cs.CS_MODE_THUMB if thumb else cs.CS_MODE_ARM)
        md.detail = False
        code = self.read(addr, count * 4)
        out: list[str] = []
        n = 0

        def stream():
            # 解読できない語（定数の置き場など）は .word として飛ばして続ける
            pos = 0
            while pos < len(code):
                got = False
                for ins in md.disasm(code[pos:], addr + pos):
                    got = True
                    yield ins
                    pos = ins.address + ins.size - addr
                if not got or pos < len(code):
                    if pos + 4 <= len(code):
                        w = struct.unpack_from('<I', code, pos)[0]
                        yield _Word(addr + pos, w)
                    pos += 4 if not thumb else 2

        for ins in stream():
            if isinstance(ins, _Word):
                out.append(f'{ins.address:08x}: .word    {ins.value:#010x}')
                n += 1
                if n >= count:
                    break
                continue
            note = ''
            ops = ins.op_str
            # pc 相対の定数の読み込み
            if ins.mnemonic.startswith('ldr') and '[pc' in ops:
                try:
                    imm = int(ops.split('#')[-1].rstrip(']!'), 0) if '#' in ops else 0
                    pc = (ins.address + (4 if thumb else 8)) & ~3
                    val = self.u32(pc + imm)
                    note = f'   ; ={val:#010x}'
                except (ValueError, IndexError):
                    pass
            out.append(f'{ins.address:08x}: {ins.mnemonic:8} {ops}{note}')
            n += 1
            if stop_at_ret and _is_ret(ins.mnemonic, ops):
                break
            if n >= count:
                break
        return out

    def words_equal(self, value: int) -> list[int]:
        pat = struct.pack('<I', value)
        res = []
        i = self.img.find(pat)
        while i >= 0:
            if i % 4 == 0:
                res.append(BASE + i)
            i = self.img.find(pat, i + 1)
        return res

    def callers(self, target: int) -> list[int]:
        """ARM の bl / blx と Thumb の bl（2 語）で target を呼ぶ番地"""
        res = []
        img = self.img
        for o in range(0, len(img) - 3, 4):
            w = struct.unpack_from('<I', img, o)[0]
            if (w & 0x0F000000) == 0x0B000000 or (w & 0xFE000000) == 0xFA000000:
                off = (w & 0xFFFFFF)
                if off & 0x800000:
                    off -= 0x1000000
                pc = BASE + o + 8
                dest = pc + off * 4
                if (w & 0xFE000000) == 0xFA000000:
                    dest += ((w >> 24) & 1) * 2
                if dest == target or dest == (target & ~1):
                    res.append(BASE + o)
        for o in range(0, len(img) - 3, 2):
            h1, h2 = struct.unpack_from('<HH', img, o)
            if (h1 & 0xF800) == 0xF000 and (h2 & 0xE800) == 0xE800:
                off = ((h1 & 0x7FF) << 12) | ((h2 & 0x7FF) << 1)
                if off & 0x400000:
                    off -= 0x800000
                dest = BASE + o + 4 + off
                if (h2 & 0xF800) == 0xE800:
                    dest &= ~3
                if dest == (target & ~1):
                    res.append(BASE + o)
        return sorted(set(res))


class _Word:
    def __init__(self, address: int, value: int):
        self.address, self.value = address, value


def _is_ret(mn: str, ops: str) -> bool:
    if mn == 'bx' and ops == 'lr':
        return True
    if mn.startswith('pop') and 'pc' in ops:
        return True
    if mn.startswith('ldm') and 'pc' in ops and 'sp' in ops:
        return True
    return False


def main() -> None:
    if len(sys.argv) < 4:
        sys.exit(__doc__)
    a = Arm9(open(sys.argv[1], 'rb').read())
    cmd, rest = sys.argv[2], [x for x in sys.argv[3:] if not x.startswith('--')]
    thumb = '--thumb' in sys.argv
    addr = int(rest[0], 0)
    if cmd == 'dis':
        n = int(rest[1], 0) if len(rest) > 1 else 64
        print('\n'.join(a.disasm(addr, n, thumb)))
    elif cmd == 'func':
        print('\n'.join(a.disasm(addr, 4000, thumb, stop_at_ret=True)))
    elif cmd == 'xref':
        for w in a.words_equal(addr):
            print(f'{w:08x}')
    elif cmd == 'calls':
        for w in a.callers(addr):
            print(f'{w:08x}')
    elif cmd in ('words', 'halves'):
        n = int(rest[1], 0) if len(rest) > 1 else 16
        step = 4 if cmd == 'words' else 2
        f = a.u32 if step == 4 else a.u16
        for i in range(n):
            if i % 8 == 0:
                print(f'\n{addr + i * step:08x}:', end='')
            print(f' {f(addr + i * step):#0{step * 2 + 2}x}', end='')
        print()


if __name__ == '__main__':
    main()
