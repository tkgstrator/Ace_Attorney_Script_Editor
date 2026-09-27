"""DS 版の字形と文字の対応から、ゲームで使うドットフォント（全文字を並べた PNG と文字の一覧）を作る。

    python3 tools/rom/build_font.py [assets/extracted/font] [--also <フォルダ>...]
    例: python3 tools/rom/build_font.py assets/extracted/font --also assets/extracted/font/YG3J assets/extracted/font/A2GJ

入力: glyphs.txt（dsfont.py）、mapping.tsv（ocr_font.py）、tools/rom/font_fixes.tsv（手で直した対応）、
      tools/rom/font_extra.txt（DS 版にない字を部品から作ったもの。compose.py）
      --also: ほかの作品のフォント（ocr_font.py --base で対応を決めたもの）。先のフォントにない字だけを足す。
              手で直した対応は tools/rom/font_fixes.<フォルダ名>.tsv
出力: ds-font.png（16×16 のマスを 64 列）、ds-font.json（{ size, columns, chars }。chars の i 文字目が i 番目のマス）

※ 元のゲームの字形そのものなので、手元で使うだけにして配布しないこと。
"""
import os
import subprocess
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from charset import ALIASES, KANJI_START  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
CELL = 16
COLUMNS = 64


def read_tsv(path: str) -> dict[int, str]:
    out = {}
    for line in open(path, encoding='utf-8'):
        if line.startswith('#') or not line.strip():
            continue
        parts = line.rstrip('\n').split('\t')
        out[int(parts[0])] = parts[1] if len(parts) > 1 else ''
    return out


def read_extra(path: str) -> dict[str, list[str]]:
    """font_extra.txt（「# 文字<TAB>説明」と 16 行の点）"""
    if not os.path.exists(path):
        return {}
    lines = open(path, encoding='utf-8').read().split('\n')
    out = {}
    for i, line in enumerate(lines):
        head = line[2:].split('\t')[0] if line.startswith('# ') else ''
        if len(head) == 1:
            out[head] = [r.ljust(CELL, '.')[:CELL] for r in lines[i + 1:i + 1 + CELL]]
    return out


def read_glyphs(src: str) -> list[list[str]]:
    return [b.split('\n')[1:17] for b in open(os.path.join(src, 'glyphs.txt')).read().split('# ')[1:]]


def top(g: list[str]) -> int | None:
    return next((y for y, r in enumerate(g) if '@' in r), None)


def other_game(src: str, base: dict[str, list[str]]) -> dict[str, list[str]]:
    """ほかの作品のフォントから、base にない字の字形を取り出す。
    上に寄せた 2 組目の字形もあるので、base と同じ字形（目印）との上下のずれを、いちばん近い番号から当てて直す"""
    glyphs = read_glyphs(src)
    mapping = read_tsv(os.path.join(src, 'mapping.tsv'))
    fixes = os.path.join(HERE, f'font_fixes.{os.path.basename(os.path.normpath(src))}.tsv')
    if os.path.exists(fixes):
        mapping.update(read_tsv(fixes))
    shift: dict[int, int] = {}
    for i, ch in mapping.items():
        if ch in base and (a := top(glyphs[i])) is not None and (b := top(base[ch])) is not None:
            shift[i] = b - a
    out: dict[str, list[str]] = {}
    for i in sorted(mapping):
        ch = mapping[i]
        if len(ch) != 1 or ch in base or ch in out or not shift:
            continue
        near = min(shift, key=lambda k: abs(k - i))
        dy = shift[near] if abs(shift[near]) in (0, 4) else 0
        g = glyphs[i]
        out[ch] = (['.' * CELL] * dy + g[:CELL - dy]) if dy >= 0 else (g[-dy:] + ['.' * CELL] * -dy)
    return out


def main() -> None:
    args = sys.argv[1:]
    also: list[str] = []
    if '--also' in args:
        k = args.index('--also')
        also, args = args[k + 1:], args[:k]
    src = args[0] if args else 'assets/extracted/font'
    glyphs = read_glyphs(src)
    mapping = read_tsv(os.path.join(src, 'mapping.tsv'))
    mapping.update(read_tsv(os.path.join(HERE, 'font_fixes.tsv')))
    # 漢字の終わり（空の番号＝字形ではないマス）より後ろは、同じ字を上に寄せた 2 組目なので使わない
    end = min((i for i, c in mapping.items() if i >= KANJI_START and c == ''), default=len(glyphs))

    # 文字 → 番号（同じ字が複数あれば若い番号）
    index: dict[str, int] = {}
    for i in sorted(mapping):
        ch = mapping[i]
        if len(ch) != 1 or i >= end:
            if len(ch) > 1:
                print(f'1 文字ではない対応を飛ばします: {i} → {ch}')
            continue
        index.setdefault(ch, i)
        # 半角の英数字・記号は全角でも引けるようにする（逆も）
        wide = unicodedata.normalize('NFKC', ch)
        if len(wide) == 1:
            index.setdefault(wide, i)
        if len(ch) == 1 and 0x21 <= ord(ch) <= 0x7E:
            index.setdefault(chr(ord(ch) + 0xFEE0), i)
    for alias, target in ALIASES.items():
        if target in index:
            index.setdefault(alias, index[target])

    # 文字 → 字形（16 行）
    shapes = {ch: glyphs[i] for ch, i in index.items()}
    added = {}
    for other in also:
        more = other_game(other, shapes)
        print(f'{other}: {len(more)} 字を足します')
        shapes.update(more)
        added.update(more)
    extra = read_extra(os.path.join(HERE, 'font_extra.txt'))
    for ch, rows in extra.items():
        shapes.setdefault(ch, rows)

    chars = sorted(shapes, key=ord)
    rows = -(-len(chars) // COLUMNS)
    w, h = COLUMNS * CELL, rows * CELL
    img = bytearray(w * h)
    for k, ch in enumerate(chars):
        g = shapes[ch]
        ox, oy = (k % COLUMNS) * CELL, (k // COLUMNS) * CELL
        for y, row in enumerate(g):
            for x, c in enumerate(row):
                if c == '@':
                    img[(oy + y) * w + ox + x] = 255
    raw = os.path.join(src, 'ds-font.gray')
    with open(raw, 'wb') as f:
        f.write(img)
    subprocess.run(['magick', '-size', f'{w}x{h}', '-depth', '8', f'gray:{raw}', os.path.join(src, 'ds-font.png')], check=True)
    os.remove(raw)
    with open(os.path.join(src, 'ds-font.json'), 'w', encoding='utf-8') as f:
        f.write('{"size": %d, "columns": %d, "chars": %s}\n' % (CELL, COLUMNS, __import__('json').dumps(''.join(chars), ensure_ascii=False)))
    print(f'書き出しました: {src}/ds-font.png / ds-font.json（{len(chars)} 文字、DS 版の字形 {len(set(index.values()))} 個 + ほかの作品 {len(added)} 字 + 追加 {len(extra)} 字）')


if __name__ == '__main__':
    main()
