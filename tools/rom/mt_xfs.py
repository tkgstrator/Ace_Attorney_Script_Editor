"""MT Framework（3DS 版）の XFS（構造化データ）を JSON にする。逆転裁判6 の .h2d・.prp（先頭 12 バイトが PRPZ の見出し）で確認。

    uv run tools/rom/mt_xfs.py <ファイル…>            # JSON を標準出力に
    uv run tools/rom/mt_xfs.py --out <フォルダー> <ファイル…>

形式（読み取れた範囲）:
- 見出し: "XFS\\0"、u16 版（0x0F）、u16、u32、u32、u32 クラスの数、u32 定義の大きさ、u32 × クラス数（定義の位置、0x18 から）
- クラスの定義: u32 ハッシュ、u32 項目の数、項目 0x28 バイト（u32 名前の位置（0x18 から）、u8 型、u8 属性、u16 大きさ、残り 0）
- データ（定義の後）: オブジェクト = u16 (クラスの番号 << 1 | 1)、u16 通し番号、u32 大きさ、項目ごとに u32 個数 + 値 × 個数。
  型 1・2（オブジェクト）の値は入れ子のオブジェクト。文字列（型 0x0E）は NUL 終わり
"""
import argparse
import json
import struct
import sys
from pathlib import Path

# 型の番号 → (struct の書式, 名前)。大きさは定義の値を使う
SCALAR = {0x38: '<HH', 3: '<?', 4: '<B', 5: '<H', 6: '<I', 7: '<Q', 8: '<b', 9: '<h', 0xA: '<i', 0xB: '<q', 0xC: '<f', 0xD: '<d'}


def parse(data: bytes):
    base = data.find(b'XFS\0')
    if base < 0:
        raise ValueError('XFS ではない')
    d = data[base:]
    ncls, defsize = struct.unpack_from('<II', d, 0x10)
    classes = []
    for i in range(ncls):
        off = 0x18 + struct.unpack_from('<I', d, 0x18 + 4 * i)[0]
        _, nm = struct.unpack_from('<II', d, off)
        members = []
        for k in range(nm):
            m = off + 8 + k * 0x28
            name_off, typ, attr, size = struct.unpack_from('<IBBH', d, m)
            end = d.index(b'\0', 0x18 + name_off)
            members.append((d[0x18 + name_off:end].decode('utf-8', 'replace'), typ, attr, size))
        classes.append(members)
    pos = 0x18 + defsize

    def obj(p: int):
        tag, _, _size = struct.unpack_from('<HHI', d, p)
        if not tag & 1:
            return None, p + 4
        cls = tag >> 1
        q = p + 8
        out = {}
        for name, typ, _, size_m in classes[cls]:
            (count,) = struct.unpack_from('<I', d, q)
            q += 4
            vals = []
            for _ in range(count):
                if typ in (1, 2):
                    v, q = obj(q)
                elif typ == 0xE:
                    end = d.index(b'\0', q)
                    v, q = d[q:end].decode('utf-8', 'replace'), end + 1
                elif typ in SCALAR and struct.calcsize(SCALAR[typ]) == size_m:
                    v = struct.unpack_from(SCALAR[typ], d, q)[0]
                    q += size_m
                else:
                    n = size_m // 4
                    v = list(struct.unpack_from(f'<{n}i', d, q)) if size_m % 4 == 0 else d[q:q + size_m].hex()
                    q += size_m
                vals.append(v)
            out[name] = vals[0] if count == 1 else vals
        return out, q

    root, _ = obj(pos)
    return root


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('files', type=Path, nargs='+')
    ap.add_argument('--out', type=Path)
    a = ap.parse_args()
    for f in a.files:
        try:
            v = parse(f.read_bytes())
        except (ValueError, struct.error, IndexError) as e:
            print(f'{f}: {e}', file=sys.stderr)
            continue
        text = json.dumps(v, ensure_ascii=False, indent=1)
        if a.out:
            a.out.mkdir(parents=True, exist_ok=True)
            (a.out / (f.name + '.json')).write_text(text + '\n')
        else:
            print(f'== {f}\n{text}')


if __name__ == '__main__':
    main()
