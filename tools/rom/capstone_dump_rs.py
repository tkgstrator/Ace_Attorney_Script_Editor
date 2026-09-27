# /// script
# requires-python = ">=3.11"
# dependencies = ["capstone>=5", "pillow>=10"]
# ///
"""Rust 版の小さな逆アセンブラー（crates/aa-rom/src/tables/armdis.rs）を capstone と比べるための表を作る。

    uv run tools/rom/capstone_dump_rs.py <rom.nds> <出力フォルダー>
    AA_CS_TSV=<出力>/cs_all.tsv AA_TRACE_TSV=<出力>/trace.tsv cargo test -p aa-rom --release --test armdis

cs_all.tsv  ARM9 の 4 バイトごとの語を capstone で 1 命令ずつ読んだもの（番地, 語, ニーモニック, 引数）
trace.tsv   tbl_invest.py の記号実行が実際に読んだ命令（番地, 語, Arm9.disasm の 1 行）
どちらも ROM から作るので assets/ の外（作業用のフォルダー）に置き、配布しない。
"""
import struct
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import capstone as cs  # noqa: E402

import arm9  # noqa: E402
from nds import arm9 as arm9_bytes  # noqa: E402


def dump_all(rom: bytes, out: Path) -> None:
    a = arm9_bytes(rom)
    md = cs.Cs(cs.CS_ARCH_ARM, cs.CS_MODE_ARM)
    with open(out, 'w') as f:
        for o in range(0, len(a) - 3, 4):
            w = struct.unpack_from('<I', a, o)[0]
            ins = list(md.disasm(a[o:o + 4], 0x02000000 + o))
            mn, ops = (ins[0].mnemonic, ins[0].op_str) if ins else ('.word', '')
            f.write(f'{0x02000000 + o:08x}\t{w:08x}\t{mn}\t{ops}\n')


def dump_trace(rom_path: str, out: Path) -> None:
    seen: dict[int, tuple[str, int]] = {}
    orig = arm9.Arm9.disasm

    def dis(self, addr, count=64, thumb=False, stop_at_ret=False):
        r = orig(self, addr, count, thumb, stop_at_ret)
        if count == 1:
            seen[addr] = (r[0], self.u32(addr))
        return r

    arm9.Arm9.disasm = dis
    import tbl_invest
    with tempfile.TemporaryDirectory() as td:
        sys.argv = ['tbl_invest.py', rom_path, f'{td}/investigation.json']
        tbl_invest.main()
    with open(out, 'w') as f:
        for a in sorted(seen):
            line, w = seen[a]
            f.write(f'{a:08x}\t{w:08x}\t{line}\n')


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    out = Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    rom = Path(sys.argv[1]).read_bytes()
    dump_all(rom, out / 'cs_all.tsv')
    dump_trace(sys.argv[1], out / 'trace.tsv')
    print(f'書き出しました: {out}/cs_all.tsv, trace.tsv')


if __name__ == '__main__':
    main()
