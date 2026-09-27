"""ROM から本文用のフォントを探して、全文字の点を切り出す。

    python3 tools/rom/dsfont.py <rom.nds> [出力フォルダ]     # 既定の出力先: assets/extracted/font

フォントの形式（逆転裁判 蘇る逆転 / AGYJ で確認）:
  - 1 文字 = 16×16 ドット、1 ドット 4 ビット、8×8 のタイル 4 枚（左上・右上・左下・右下）= 128 バイト
  - 文字の点は値 3、背景は 0
  - 文字はゲーム独自の文字コードの順に並ぶ（数字・英字・かな・記号 → 漢字 → 数字〜記号をもう 1 組）

出力:
  glyphs.txt   1 文字ずつ「# 番号」と 16 行の点（@ が点）
  sheet.png    全文字を並べた確認用の画像（32 列、1 文字 18×18）
"""
import os
import re
import subprocess
import sys

CELL = 16
GLYPH_BYTES = 128
TILES = [(0, 0), (1, 0), (0, 1), (1, 1)]
#: 値が 0 と 3 だけのバイト（1 バイト = 2 ドット）
FONT_BYTES = re.compile(rb'[\x00\x03\x30\x33]{%d,}' % (GLYPH_BYTES * 1000))


def find_font(rom: bytes) -> tuple[int, int]:
    """(先頭, 文字数)。0 と 3 だけが 1,000 文字ぶん以上続く所から、文字の区切りを決めて取り出す"""
    run = max(FONT_BYTES.finditer(rom), key=lambda m: m.end() - m.start(), default=None)
    if not run:
        sys.exit('フォントらしい所が見つかりません')

    # 区切りの位置（4 バイト単位でずらして試す）: 文字のマスは一番上の行と下の 2 行が空くので、
    # その行に点がないマスがいちばん多くなる位置を選ぶ
    def blank_margins(offset: int) -> int:
        n = 0
        for base in range(run.start() + offset, run.end() - GLYPH_BYTES, GLYPH_BYTES * 7):
            cell = decode(rom, base)
            n += not any(cell[0]) and not any(cell[14]) and not any(cell[15])
        return n
    offset = max(range(0, GLYPH_BYTES, 4), key=blank_margins)
    start = run.start() + offset
    count = (run.end() - start) // GLYPH_BYTES
    # 前後の空のマスは除く
    while count and not any(rom[start:start + GLYPH_BYTES]):
        start += GLYPH_BYTES
        count -= 1
    while count and not any(rom[start + (count - 1) * GLYPH_BYTES:start + count * GLYPH_BYTES]):
        count -= 1
    return start, count


def decode(rom: bytes, base: int) -> list[list[int]]:
    """1 文字ぶん（16×16）の値"""
    cell = [[0] * CELL for _ in range(CELL)]
    for t, (tx, ty) in enumerate(TILES):
        for y in range(8):
            for x in range(8):
                b = rom[base + t * 32 + y * 4 + x // 2]
                cell[ty * 8 + y][tx * 8 + x] = (b >> 4) if x % 2 else (b & 0xF)
    return cell


def extract(rom: bytes) -> list[list[str]]:
    start, count = find_font(rom)
    print(f'フォント: ROM の 0x{start:x} から {count} 文字')
    return [[''.join('@' if v else '.' for v in row) for row in decode(rom, start + i * GLYPH_BYTES)] for i in range(count)]


def write_sheet(glyphs: list[list[str]], path: str, cols: int = 32) -> None:
    """全文字を並べた画像（白い点、マスの間は灰色）"""
    pad = CELL + 2
    w, h = cols * pad, -(-len(glyphs) // cols) * pad
    img = bytearray([48]) * (w * h)
    for i, g in enumerate(glyphs):
        ox, oy = (i % cols) * pad + 1, (i // cols) * pad + 1
        for y, row in enumerate(g):
            for x, c in enumerate(row):
                img[(oy + y) * w + ox + x] = 255 if c == '@' else 0
    raw = path + '.gray'
    with open(raw, 'wb') as f:
        f.write(img)
    subprocess.run(['magick', '-size', f'{w}x{h}', '-depth', '8', f'gray:{raw}', path], check=True)
    os.remove(raw)


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit('使い方: python3 tools/rom/dsfont.py <rom.nds> [出力フォルダ]')
    rom = open(sys.argv[1], 'rb').read()
    out = sys.argv[2] if len(sys.argv) > 2 else 'assets/extracted/font'
    os.makedirs(out, exist_ok=True)
    glyphs = extract(rom)
    with open(os.path.join(out, 'glyphs.txt'), 'w') as f:
        for i, g in enumerate(glyphs):
            f.write(f'# {i}\n' + '\n'.join(g) + '\n')
    write_sheet(glyphs, os.path.join(out, 'sheet.png'))
    print(f'書き出しました: {out}/glyphs.txt, sheet.png')


if __name__ == '__main__':
    main()
