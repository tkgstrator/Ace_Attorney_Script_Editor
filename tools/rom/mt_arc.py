"""MT Framework（3DS 版）の ARC を展開する。逆転裁判5（版 0x10）・6（版 0x11）で確認。

    uv run tools/rom/mt_arc.py <romfs> <出力先>

<romfs> の下のすべての .arc を <出力先>/<.arc の相対パス（拡張子なし）>/<項目の名前>.<種類> に書き出し、
<出力先>/index.tsv に一覧（ARC・項目・種類のハッシュ・大きさ）を書く。

形式: "ARC\\0"、u16 版、u16 個数、4 バイト空き、項目 0x50 バイト × 個数
（名前 64 バイト、u32 種類のハッシュ、u32 圧縮後の大きさ、u32 展開後の大きさ | 0x40000000、u32 位置）。
中身は zlib。拡張子はハッシュからは決めず、中身の先頭 4 バイト（"TEX\\0" など）の小文字にする。
"""
import struct
import sys
import zlib
from pathlib import Path


def entries(data: bytes):
    if data[:4] != b'ARC\0':
        raise ValueError('ARC ではない')
    count = struct.unpack_from('<H', data, 6)[0]
    for i in range(count):
        e = 0x0C + i * 0x50
        name = data[e:e + 64].split(b'\0')[0].decode('ascii')
        type_hash, csize, dsize, off = struct.unpack_from('<IIII', data, e + 64)
        body = zlib.decompress(data[off:off + csize]) if csize else b''
        if len(body) != dsize & 0x1FFFFFFF:
            raise ValueError(f'{name}: 展開後の大きさが合わない')
        yield name.replace('\\', '/'), type_hash, body


def ext_of(body: bytes, type_hash: int) -> str:
    magic = body[:4].rstrip(b'\0\xff')
    if magic and all(0x30 <= c < 0x7F for c in magic):
        return magic.decode().lower()
    return f'{type_hash:08x}'


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    rows = []
    for arc in sorted(src.rglob('*.arc')):
        rel = arc.relative_to(src).with_suffix('')
        for name, type_hash, body in entries(arc.read_bytes()):
            dest = out / rel / f'{name}.{ext_of(body, type_hash)}'
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(body)
            rows.append(f'{rel}\t{dest.relative_to(out / rel)}\t{type_hash:08X}\t{len(body)}')
    out.mkdir(parents=True, exist_ok=True)
    (out / 'index.tsv').write_text('arc\tpath\ttype\tsize\n' + '\n'.join(rows) + '\n')
    print(f'{len(rows)} 個 → {out}')


if __name__ == '__main__':
    main()
