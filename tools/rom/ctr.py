"""3DS のカードイメージ（.3ds、NCSD）からゲーム本体（NCCH）を復号して取り出す（ROM は変更しない）。

    uv run tools/rom/ctr.py <rom.3ds> --keys <aes_keys.txt> <出力先>
    uv run tools/rom/ctr.py <rom.3ds> --keys <aes_keys.txt> --info

出力先に exheader.bin・exefs/（.code、icon、banner、logo）・romfs/（RomFS のファイルそのまま）を書く。
鍵は aes_keys.txt（slot0x2CKeyX などの行と generatorConstant）から読む。鍵の値は表示しない。
"""
import argparse
import struct
import sys
from dataclasses import dataclass
from pathlib import Path

from Crypto.Cipher import AES
from Crypto.Util import Counter

MEDIA = 0x200
M128 = (1 << 128) - 1
SECONDARY_SLOT = {0x00: 0x2C, 0x01: 0x25, 0x0A: 0x18, 0x0B: 0x1B}


def rol(x: int, n: int) -> int:
    return ((x << n) | (x >> (128 - n))) & M128


def load_keys(path: Path) -> dict[str, int]:
    keys = {}
    for line in path.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            keys[k.strip()] = int(v.strip(), 16)
    return keys


def scramble(key_x: int, key_y: int, c: int) -> bytes:
    return rol((rol(key_x, 2) ^ key_y) + c & M128, 87).to_bytes(16, 'big')


@dataclass
class Ncch:
    base: int
    header: bytes
    key1: bytes | None
    key2: bytes | None

    def u32(self, off: int) -> int:
        return struct.unpack_from('<I', self.header, off)[0]

    @property
    def product(self) -> str:
        return self.header[0x150:0x160].rstrip(b'\0').decode()

    @property
    def title_id(self) -> int:
        return struct.unpack_from('<Q', self.header, 0x118)[0]

    def region(self, off: int) -> tuple[int, int]:
        return self.u32(off) * MEDIA, self.u32(off + 4) * MEDIA

    def counter(self, kind: int) -> int:
        pid = self.header[0x108:0x110]
        if struct.unpack_from('<H', self.header, 0x112)[0] == 1:
            return int.from_bytes(pid + bytes(8), 'big')
        return int.from_bytes(pid[::-1] + bytes([kind]) + bytes(7), 'big')


def open_ncch(f, keys: dict[str, int] | None) -> Ncch:
    f.seek(0)
    ncsd = f.read(0x200)
    if ncsd[0x100:0x104] != b'NCSD':
        sys.exit('NCSD のカードイメージではない')
    base = struct.unpack_from('<I', ncsd, 0x120)[0] * MEDIA
    f.seek(base)
    h = f.read(0x200)
    flags = h[0x188:0x190]
    if flags[7] & 0x04:
        return Ncch(base, h, None, None)
    if flags[7] & 0x21:
        sys.exit('固定鍵・シード暗号の NCCH には対応していない')
    if keys is None:
        return Ncch(base, h, None, None)
    c = keys['generatorConstant']
    key_y = int.from_bytes(h[:16], 'big')
    k1 = scramble(keys['slot0x2CKeyX'], key_y, c)
    k2 = scramble(keys[f'slot0x{SECONDARY_SLOT[flags[3]]:02X}KeyX'], key_y, c)
    return Ncch(base, h, k1, k2)


def read_dec(f, ncch: Ncch, key: bytes | None, ctr: int, region_off: int, off: int, size: int) -> bytes:
    """区画（NCCH 内の位置 region_off）の先頭から off バイト目以降 size バイトを復号して返す"""
    start = off & ~0xF
    f.seek(ncch.base + region_off + start)
    data = f.read(size + (off - start))
    if key is not None:
        pad = (-len(data)) % 16
        c = AES.new(key, AES.MODE_CTR, counter=Counter.new(128, initial_value=ctr + start // 16))
        data = c.decrypt(data + bytes(pad))[:len(data)]
    return data[off - start:]


def extract_exefs(f, ncch: Ncch, out: Path) -> list[str]:
    exefs_off, _ = ncch.region(0x1A0)
    ctr = ncch.counter(2)
    head = read_dec(f, ncch, ncch.key1, ctr, exefs_off, 0, 0x200)
    names = []
    for i in range(10):
        name = head[i * 16:i * 16 + 8].rstrip(b'\0').decode()
        foff, fsize = struct.unpack_from('<II', head, i * 16 + 8)
        if not name:
            continue
        key = ncch.key2 if name == '.code' else ncch.key1
        data = read_dec(f, ncch, key, ctr, exefs_off, 0x200 + foff, fsize)
        (out / 'exefs').mkdir(parents=True, exist_ok=True)
        (out / 'exefs' / (name.lstrip('.') + '.bin')).write_bytes(data)
        names.append(f'{name} ({fsize} バイト)')
    return names


class RomFs:
    def __init__(self, f, ncch: Ncch):
        self.f, self.ncch = f, ncch
        self.off, _ = ncch.region(0x1B0)
        self.ctr = ncch.counter(3)
        ivfc = self.read(0, 0x60)
        if ivfc[:4] != b'IVFC':
            sys.exit('RomFS の見出しが読めない（鍵が違う可能性がある）')
        master = struct.unpack_from('<I', ivfc, 0x08)[0]
        block = 1 << struct.unpack_from('<I', ivfc, 0x4C)[0]
        self.l3 = (0x60 + master + block - 1) & ~(block - 1)
        h = struct.unpack_from('<10I', self.read(self.l3, 0x28))
        self.dir_meta = self.read(self.l3 + h[3], h[4])
        self.file_meta = self.read(self.l3 + h[7], h[8])
        self.data_off = self.l3 + h[9]

    def read(self, off: int, size: int) -> bytes:
        return read_dec(self.f, self.ncch, self.ncch.key2, self.ctr, self.off, off, size)

    def files(self) -> list[tuple[str, int, int]]:
        out: list[tuple[str, int, int]] = []

        def name(meta: bytes, at: int, n: int) -> str:
            return meta[at:at + n].decode('utf-16le')

        def walk(d: int, prefix: str) -> None:
            _, _, child, file, _, n = struct.unpack_from('<6I', self.dir_meta, d)
            path = prefix + (name(self.dir_meta, d + 0x18, n) + '/' if d else '')
            while file != 0xFFFFFFFF:
                _, sib, doff, dsize, _, fn = struct.unpack_from('<IIQQII', self.file_meta, file)
                out.append((path + name(self.file_meta, file + 0x20, fn), doff, dsize))
                file = sib
            while child != 0xFFFFFFFF:
                walk(child, path)
                child = struct.unpack_from('<I', self.dir_meta, child + 4)[0]

        walk(0, '')
        return out

    def extract(self, out: Path) -> list[tuple[str, int, int]]:
        files = self.files()
        for path, doff, size in files:
            dest = out / path
            dest.parent.mkdir(parents=True, exist_ok=True)
            with dest.open('wb') as w:
                for pos in range(0, size, 1 << 24):
                    w.write(self.read(self.data_off + doff + pos, min(1 << 24, size - pos)))
        return files


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('rom', type=Path)
    ap.add_argument('out', type=Path, nargs='?')
    ap.add_argument('--keys', type=Path, required=True)
    ap.add_argument('--info', action='store_true', help='見出しと RomFS のファイル一覧だけを表示する')
    a = ap.parse_args()
    with a.rom.open('rb') as f:
        ncch = open_ncch(f, load_keys(a.keys))
        print(f'{ncch.product} {ncch.title_id:016X}')
        exh_off = 0x200
        exh = read_dec(f, ncch, ncch.key1, ncch.counter(1), exh_off, 0, 0x400)
        print('ExHeader の名前:', exh[:8].rstrip(b'\0').decode(errors='replace'))
        romfs = RomFs(f, ncch)
        if a.info or a.out is None:
            for path, _, size in romfs.files():
                print(f'{size:>10} {path}')
            return
        a.out.mkdir(parents=True, exist_ok=True)
        (a.out / 'exheader.bin').write_bytes(read_dec(f, ncch, ncch.key1, ncch.counter(1), exh_off, 0, 0x800))
        for n in extract_exefs(f, ncch, a.out):
            print('ExeFS', n)
        files = romfs.extract(a.out / 'romfs')
        with (a.out / 'romfs.tsv').open('w') as w:
            w.write('size\tpath\n')
            for path, _, size in files:
                w.write(f'{size}\t{path}\n')
        print(f'RomFS {len(files)} 個 → {a.out / "romfs"}')


if __name__ == '__main__':
    main()
