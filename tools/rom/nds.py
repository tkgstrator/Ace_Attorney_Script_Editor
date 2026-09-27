"""NDS の ROM イメージの読み出し（ROM は変更しない）。

    python3 tools/rom/nds.py <rom.nds>            # ファイル一覧
    python3 tools/rom/nds.py <rom.nds> <パス>     # そのファイルを標準出力に書き出す
"""
import struct
import sys
from dataclasses import dataclass


@dataclass
class NdsFile:
    id: int
    path: str
    start: int
    end: int


def list_files(rom: bytes) -> list[NdsFile]:
    """ファイル名の表（FNT）と位置の表（FAT）から、ROM 内のファイル一覧を作る"""
    fnt, fat = struct.unpack_from('<I', rom, 0x40)[0], struct.unpack_from('<I', rom, 0x48)[0]
    files: list[NdsFile] = []

    def walk(dir_id: int, prefix: str) -> None:
        entry = fnt + (dir_id & 0xFFF) * 8
        p = fnt + struct.unpack_from('<I', rom, entry)[0]
        file_id = struct.unpack_from('<H', rom, entry + 4)[0]
        while True:
            n = rom[p]
            p += 1
            if n == 0:
                break
            name = rom[p:p + (n & 0x7F)].decode('shift_jis')
            p += n & 0x7F
            if n > 0x80:
                sub = struct.unpack_from('<H', rom, p)[0]
                p += 2
                walk(sub, f'{prefix}{name}/')
            else:
                start, end = struct.unpack_from('<II', rom, fat + file_id * 8)
                files.append(NdsFile(file_id, f'{prefix}{name}', start, end))
                file_id += 1

    walk(0xF000, '')
    return files


def arm9(rom: bytes) -> bytes:
    """プログラム本体（ARM9）"""
    off, _entry, _ram, size = struct.unpack_from('<4I', rom, 0x20)
    return rom[off:off + size]


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit('使い方: python3 tools/rom/nds.py <rom.nds> [パス]')
    rom = open(sys.argv[1], 'rb').read()
    files = list_files(rom)
    if len(sys.argv) > 2:
        f = next((f for f in files if f.path == sys.argv[2]), None)
        if not f:
            sys.exit(f'見つかりません: {sys.argv[2]}')
        sys.stdout.buffer.write(rom[f.start:f.end])
        return
    for f in files:
        print(f'{f.id:4}  {f.end - f.start:9}  {f.path}')


if __name__ == '__main__':
    main()
