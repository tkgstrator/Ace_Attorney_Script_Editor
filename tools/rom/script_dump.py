"""台本（mes_all.bin）を命令と文の読める形に書き出す。命令の一覧は script_format.py。

    python3 tools/rom/script_dump.py <rom.nds または mes_all.bin> [出力先（assets/extracted/script）]

mes_all.bin の形:
  - u32 項目の数（74）、(u32 位置, u32 大きさ) × 項目の数。各項目は DS 標準の圧縮（LZ77 0x10）
  - 偶数番の項目が日本語、次の奇数番が同じ場面の英語（区画の数と命令の並びが同じ）
  - 項目を展開すると u32 区画の数 N、u32 区画の位置 × N（項目の先頭からのバイト位置）、続いて区画の中身
  - 区画の中身は u16 の並び。128 以上は「フォントの番号 + 128」の文字、128 未満は命令（決まった数の u16 の引数が続く）

出力:
  NNN.txt     項目ごと。区画ごとに「== 区画 k ==」、命令は [名前 引数…]、文はそのまま
  index.tsv   項目の一覧（言語・区画の数・最初の日時と場所の表示）
  names.tsv   名前の番号（14）ごとの使われた回数と最初の台詞
  chars.tsv   人物の番号（30）ごとの動きの番号と、同時に出た名前の番号
  bg_map.tsv  背景の番号（27）→ data.bin の位置 → data/tail/bg/ のファイル（ROM を渡したときだけ）
              ARM9 の 0x020a7cb4 にある 241 個 × 16 バイトの表（u32 位置, u32 大きさ, u32 フラグ, u32 種類）の添字が
              台本の背景の番号。data/tail/bg/ の bgNNN_ の NNN は種類 = 0x8000 のものだけを数えた番号なので、ずれる
"""
import collections
import os
import struct
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_font import read_tsv  # noqa: E402
from charset import CODE_BASE, LAYOUT  # noqa: E402
from nitro import decompress  # noqa: E402
from script_format import ARGC, OPCODES  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


def load_chars() -> dict[int, str]:
    """フォントの番号 → 文字（LAYOUT、OCR の結果、手で直したものの順に上書き）"""
    out = dict(enumerate(LAYOUT))
    m = ROOT / 'assets/extracted/font/mapping.tsv'
    if m.exists():
        out.update({k: v for k, v in read_tsv(str(m)).items() if k >= len(LAYOUT) and v})
    out.update({k: v for k, v in read_tsv(str(ROOT / 'tools/rom/font_fixes.tsv')).items() if v})
    return out


def read_mes(path: str) -> bytes:
    b = open(path, 'rb').read()
    if path.endswith('.nds'):
        from nds import list_files
        f = next(f for f in list_files(b) if f.path == 'mes_all.bin')
        b = b[f.start:f.end]
    return b


def entries(mes: bytes) -> list[list[int]]:
    """各項目を展開して u16 の並びにする"""
    n = struct.unpack_from('<I', mes, 0)[0]
    out = []
    for i in range(n):
        off, _size = struct.unpack_from('<II', mes, 4 + i * 8)
        d, _ = decompress(mes, off)
        out.append(list(struct.unpack(f'<{len(d) // 2}H', d[:len(d) // 2 * 2])))
    return out


def sections(e: list[int]) -> list[list[int]]:
    """項目を区画に分ける（区画の位置はバイト単位）"""
    n = e[0] | e[1] << 16
    offs = [(e[2 + 2 * i] | e[3 + 2 * i] << 16) // 2 for i in range(n)] + [len(e)]
    return [e[offs[i]:offs[i + 1]] for i in range(n)]


def decode(s: list[int]) -> list[tuple]:
    """区画を ('T', 文) と (命令の番号, 引数のタプル) の並びにする"""
    out, i = [], 0
    while i < len(s):
        w = s[i]
        if w >= CODE_BASE:
            j = i
            while j < len(s) and s[j] >= CODE_BASE:
                j += 1
            out.append(('T', [x - CODE_BASE for x in s[i:j]]))
            i = j
            continue
        n = ARGC.get(w, 0)
        out.append((w, tuple(s[i + 1:i + 1 + n])))
        i += 1 + n
    return out


def sec(v: int) -> str:
    """「区画 + 128」の値を区画の番号として書く"""
    return f'§{v - 128}' if v >= 128 else f'?{v}'


def fmt(op: int, a: tuple) -> str:
    """命令を読める形にする"""
    name = OPCODES.get(op, (f'op{op}',))[0]
    if op == 14:
        return f'[name {a[0] >> 8}{"*" if a[0] & 0xFF else ""}]'
    if op == 30:
        c = a[0]
        pos = ('' if not c & 0xC000 else f' pos{c >> 14}')
        return f'[char {c & 0x3FFF}{pos} talk {a[1]} idle {a[2]}]' if c else '[char off]'
    if op == 27:
        return '[bg off]' if a[0] == 0xFFF else f'[bg {a[0] & 0x7FFF}{" alt" if a[0] & 0x8000 else ""}]'
    if op in (8, 9):
        return f'[{name} ' + ' '.join(sec(x) for x in a) + ']'
    if op in (10, 32, 44, 111):
        return f'[{name} {sec(a[0])}]'
    if op in (54, 120, 122):
        return f'[{name} §{a[0]}]'
    if op == 15:
        return f'[{name} {sec(a[0])} {a[1]}]'
    if op == 53:
        f, want, glob = a[0] >> 8, a[0] & 1, a[0] & 0x80
        dest = f'§{a[1]}' if glob else f'+{a[1]}B'
        return f'[if flag {f} == {want} → {dest}]'
    if op == 16:
        return f'[flag {(a[0] >> 8) & 0x7F}:{a[0] & 0xFF} = {a[0] >> 15}]'
    if op in (23, 24):
        kind = 'profile' if a[0] & 0x8000 else 'evidence'
        return f'[{name} {kind} {a[0] & 0x3FFF}{" notice" if a[0] & 0x4000 else ""}]'
    if op == 3:
        return f'[color {a[0]}]'
    if op == 1:
        return '\n'
    if op == 2:
        return '[page]\n'
    return f'[{name}' + ''.join(f' {x}' for x in a) + ']'


def text(glyphs: list[int], chars: dict[int, str]) -> str:
    return ''.join(chars.get(g, f'{{{g}}}') for g in glyphs)


def dump(entry: list[int], chars: dict[int, str], stats: dict) -> tuple[str, str]:
    """項目を文字にし、(本文, 最初の日時と場所の表示) を返す"""
    lines, caption = [], ''
    for k, s in enumerate(sections(entry)):
        lines.append(f'\n== 区画 {k} ==\n')
        cur_name, centered = None, False
        for t in decode(s):
            if t[0] == 'T':
                txt = text(t[1], chars)
                lines.append(txt)
                if centered and not caption:
                    caption = txt
                if cur_name is not None:
                    stats['name'][cur_name][1].append(txt)
                continue
            op, a = t
            if op == 14:
                cur_name = a[0] >> 8
                stats['name'][cur_name][0] += 1
            if op == 30 and a[0]:
                stats['char'][a[0] & 0x3FFF]['anims'].update(a[1:])
                stats['char_pending'] = a[0] & 0x3FFF
            if op == 14 and stats.get('char_pending') is not None and a[0] >> 8:
                stats['char'][stats['char_pending']]['names'][a[0] >> 8] += 1
                stats['char_pending'] = None
            if op == 93:
                centered = a[0] == 1
            lines.append(fmt(op, a))
    return ''.join(lines), caption.replace('　', ' ')


BG_TABLE, BG_COUNT = 0x020a7cb4, 241


def bg_map(rom: bytes) -> list[str]:
    """台本の背景の番号 → data.bin の位置と、書き出し済みのファイル"""
    from nds import arm9
    off, _e, ram, _s = struct.unpack_from('<4I', rom, 0x20)
    a = arm9(rom)
    bgdir = ROOT / 'assets/extracted/data/tail/bg'
    files = {f.stem.split('_')[-1]: f.name for f in bgdir.glob('*.png')} if bgdir.exists() else {}
    rows = ['背景の番号\tdata.bin の位置\t大きさ\tフラグ\t種類\tファイル（data/tail/bg/）']
    for k in range(BG_COUNT):
        p, size, flags, kind = struct.unpack_from('<4I', a, BG_TABLE - ram + 16 * k)
        rows.append(f'{k}\t{p:#x}\t{size}\t{flags:#x}\t{kind:#x}\t{files.get(f"{p:x}", "-")}')
    return rows


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit('使い方: python3 tools/rom/script_dump.py <rom.nds または mes_all.bin> [出力先]')
    out = Path(sys.argv[2] if len(sys.argv) > 2 else ROOT / 'assets/extracted/script')
    out.mkdir(parents=True, exist_ok=True)
    chars = load_chars()
    ents = entries(read_mes(sys.argv[1]))
    stats = {'name': collections.defaultdict(lambda: [0, []]),
             'char': collections.defaultdict(lambda: {'anims': set(), 'names': collections.Counter()})}
    index = ['項目\t言語\t区画の数\t最初の日時・場所の表示']
    for i, e in enumerate(ents):
        if i % 2:
            s = {'name': collections.defaultdict(lambda: [0, []]),
                 'char': collections.defaultdict(lambda: {'anims': set(), 'names': collections.Counter()})}
        else:
            s = stats
        body, cap = dump(e, chars, s)
        (out / f'{i:03}.txt').write_text(body.lstrip('\n') + '\n', encoding='utf-8')
        index.append(f'{i:03}\t{"英" if i % 2 else "日"}\t{len(sections(e))}\t{cap}')
    (out / 'index.tsv').write_text('\n'.join(index) + '\n', encoding='utf-8')
    rows = ['名前の番号\t回数\t最初の台詞']
    for k in sorted(stats['name']):
        n, txts = stats['name'][k]
        first = next((t for t in txts if len(t) > 3), txts[0] if txts else '')
        rows.append(f'{k}\t{n}\t{first[:30]}')
    (out / 'names.tsv').write_text('\n'.join(rows) + '\n', encoding='utf-8')
    rows = ['人物の番号\t動きの番号\t直後の名前の番号（回数）']
    for k in sorted(stats['char']):
        c = stats['char'][k]
        an = sorted(c['anims'])
        rng = f'{an[0]}-{an[-1]} ({len(an)} 個)' if an else ''
        rows.append(f'{k}\t{rng}\t' + ' '.join(f'{n}({m})' for n, m in c['names'].most_common(3)))
    (out / 'chars.tsv').write_text('\n'.join(rows) + '\n', encoding='utf-8')
    if sys.argv[1].endswith('.nds'):
        (out / 'bg_map.tsv').write_text('\n'.join(bg_map(open(sys.argv[1], 'rb').read())) + '\n', encoding='utf-8')
    print(f'{len(ents)} 項目を {out} に書き出しました')


if __name__ == '__main__':
    main()
