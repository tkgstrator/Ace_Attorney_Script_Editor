"""MT Framework の GMD（文章のデータ）を読める形にする。逆転裁判5（版 0x10201）・6（版 0x10302）で確認。

    uv run tools/rom/mt_gmd.py <入力フォルダー…> --out <出力先>

入力フォルダーの下のすべての .gmd を <出力先>/<入力フォルダーの名前>/<相対パス>.txt に書き、
<出力先>/index.tsv（ファイル・文の数・文字数）と <出力先>/commands.tsv（<Ennn> 命令の数と引数の数）を作る。

形式: "GMD\\0"、u32 版、u32 言語、u32 × 2（0 か作った日時らしき値）、u32 ラベルの数、u32 文の数、
u32 ラベル名の大きさ、u32 文の大きさ、u32 名前の長さ、名前（NUL 終わり）、ラベルの項目、ラベル名、文。
- 版 0x10201: ラベルの項目は (u32 文の番号, u32 ラベル名へのポインター) の 8 バイト。
  文は 2 つの鍵を XOR してあり、i バイト目は key1[i % 32] ^ key2[i % 32] と XOR すると戻る
- 版 0x10302: ラベルの項目は (u32 文の番号, u32 ハッシュ × 2, u32 ラベル名の位置, u32 次の項目) の 0x14 バイト。
  ラベルがあるときは続けてハッシュ表（u32 × 256）がある。文は暗号化されていない
文は NUL で区切った UTF-8。ラベルの無い文もある。
"""
import argparse
import collections
import re
import struct
from pathlib import Path

KEY1 = b'fjfajfahajra;tira9tgujagjjgajgoa'
KEY2 = b'mva;eignhpe/dfkfjgp295jtugkpejfu'
XOR = bytes(a ^ b for a, b in zip(KEY1, KEY2))
TAG = re.compile(r'<(E\d+|[A-Z]+)((?: -?\d+)*)>')


def parse(data: bytes) -> tuple[str, list[tuple[str | None, str]]]:
    if data[:4] != b'GMD\0':
        raise ValueError('GMD ではない')
    ver, _, _, _, nl, ns, ls, ss, nn = struct.unpack_from('<9I', data, 4)
    name = data[0x28:0x28 + nn].decode('ascii')
    p = 0x28 + nn + 1
    if ver == 0x10201:
        items = [struct.unpack_from('<I', data, p + i * 8)[0] for i in range(nl)]
        p += nl * 8
    elif ver == 0x10302:
        items = [struct.unpack_from('<I', data, p + i * 0x14)[0] for i in range(nl)]
        p += nl * 0x14 + (0x400 if nl else 0)
    else:
        raise ValueError(f'知らない版 {ver:#x}')
    labels = data[p:p + ls].split(b'\0')[:nl]
    body = data[p + ls:p + ls + ss]
    if ver == 0x10201:
        body = bytes(c ^ XOR[i % 32] for i, c in enumerate(body))
    texts = body.split(b'\0')[:ns]
    by_index = {i: l.decode('utf-8') for i, l in zip(items, labels)}
    return name, [(by_index.get(i), t.decode('utf-8', 'replace')) for i, t in enumerate(texts)]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('src', type=Path, nargs='+')
    ap.add_argument('--out', type=Path, required=True)
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    cmds: collections.Counter = collections.Counter()
    rows = []
    for src in a.src:
        for f in sorted(src.rglob('*.gmd')):
            name, entries = parse(f.read_bytes())
            source = f'{src.name}/{f.relative_to(src)}'
            lines = [f'# {source}']
            for i, (label, text) in enumerate(entries):
                lines.append(f'== {i} {label or ""}'.rstrip())
                lines.append(text)
                for m in TAG.finditer(text):
                    cmds[(m.group(1), len(m.group(2).split()))] += 1
            dest = a.out / src.name / f.relative_to(src).with_suffix('.txt')
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text('\n'.join(lines) + '\n')
            bad = sum(t.count('�') for _, t in entries)
            rows.append(f'{source}\t{name}\t{len(entries)}\t{sum(len(t) for _, t in entries)}\t{bad}')
    (a.out / 'index.tsv').write_text('file\tname\tentries\tchars\tbad_chars\n' + '\n'.join(rows) + '\n')
    (a.out / 'commands.tsv').write_text(
        'command\targs\tcount\n' + ''.join(f'{c}\t{n}\t{k}\n' for (c, n), k in sorted(cmds.items())))
    print(f'{len(rows)} 個 → {a.out}')


if __name__ == '__main__':
    main()
