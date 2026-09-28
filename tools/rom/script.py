"""台詞のデータ（mes_all.bin）を読み、文字（フォントの番号）の並びに分ける。

    python3 tools/rom/script.py <rom.nds>     # 先頭の数行を表示

mes_all.bin の形式（逆転裁判 蘇る逆転 / AGYJ で確認）:
  - u32 個数 N、続いて N 個の (u32 位置, u32 大きさ)。各項目は DS 標準の圧縮（LZ77 など）
  - 展開すると 2 バイト（リトルエンディアン）の並び。128 以上は「フォントの番号 + 128」、128 未満は制御コード
"""
import os
import struct
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from charset import CODE_BASE, LAYOUT  # noqa: E402
from nds import list_files  # noqa: E402
from nitro import decompress  # noqa: E402


def read_script(rom: bytes) -> bytes:
    f = next(f for f in list_files(rom) if f.path == 'mes_all.bin')
    return rom[f.start:f.end]


def text_runs(mes: bytes, glyph_count: int, min_len: int = 2) -> list[list[int]]:
    """制御コードで区切った、フォントの番号の並び（min_len 文字以上のもの）"""
    n = struct.unpack_from('<I', mes, 0)[0]
    runs: list[list[int]] = []
    for i in range(n):
        off, _size = struct.unpack_from('<II', mes, 4 + i * 8)
        data, _ = decompress(mes, off)
        cur: list[int] = []
        for (w,) in struct.iter_unpack('<H', data[:len(data) // 2 * 2]):
            if CODE_BASE <= w < CODE_BASE + glyph_count:
                cur.append(w - CODE_BASE)
                continue
            if len(cur) >= min_len:
                runs.append(cur)
            cur = []
        if len(cur) >= min_len:
            runs.append(cur)
    return runs


def show(run: list[int], names: dict[int, str] | None = None) -> str:
    """番号の並びを文字にする（分からない番号は [番号]）"""
    names = names or {}
    return ''.join(LAYOUT[i] if i < len(LAYOUT) else names.get(i, f'[{i}]') for i in run)


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit('使い方: python3 tools/rom/script.py <rom.nds>')
    runs = text_runs(read_script(open(sys.argv[1], 'rb').read()), glyph_count=2000)
    print(f'{len(runs)} 行')
    for r in runs[:20]:
        print(show(r))


if __name__ == '__main__':
    main()
