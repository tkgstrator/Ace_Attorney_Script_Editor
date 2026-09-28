"""DS 版フォントで実際に描ける漢字の一覧を書き出す（docs/available-kanji.txt の作り方）。

    python3 tools/rom/available_kanji.py [出力先]

既定では次の対応表の和集合を取る（ROM を自分で吸い出していないと空になるものは無視する）。
    assets/extracted/font/mapping.tsv        + tools/rom/font_fixes.tsv          （GS1・蘇る逆転）
    assets/extracted/font/A2GJ/mapping.tsv   + tools/rom/font_fixes.A2GJ.tsv     （GS2）
    assets/extracted/font/YG3J/mapping.tsv   + tools/rom/font_fixes.YG3J.tsv     （GS3）

出力は Unicode の並び順（重複なし）。ひらがな・カタカナ・記号は LAYOUT にあるので含めない
（漢字（KANJI_START 以降）で、CJK 統合漢字の範囲の 1 文字だけを対象にする）。
"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_font import read_tsv  # noqa: E402
from charset import KANJI_START, LAYOUT  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
IS_KANJI = re.compile(r'[㐀-鿿]')

#: (フォントの場所, 手直しの場所) のペア。フォントの場所が無ければ無視する
SOURCES = [
    (ROOT / 'assets/extracted/font/mapping.tsv', ROOT / 'tools/rom/font_fixes.tsv'),
    (ROOT / 'assets/extracted/font/A2GJ/mapping.tsv', ROOT / 'tools/rom/font_fixes.A2GJ.tsv'),
    (ROOT / 'assets/extracted/font/YG3J/mapping.tsv', ROOT / 'tools/rom/font_fixes.YG3J.tsv'),
]


def kanji_set(mapping_path: Path, fixes_path: Path) -> set[str]:
    d = dict(enumerate(LAYOUT))
    if mapping_path.exists():
        d.update({k: v for k, v in read_tsv(str(mapping_path)).items() if k >= len(LAYOUT) and v})
    if fixes_path.exists():
        d.update({k: v for k, v in read_tsv(str(fixes_path)).items() if v})
    return {v for k, v in d.items() if k >= KANJI_START and v and len(v) == 1 and IS_KANJI.match(v)}


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'docs/available-kanji.txt'
    union: set[str] = set()
    found = []
    for mapping_path, fixes_path in SOURCES:
        s = kanji_set(mapping_path, fixes_path)
        if s:
            found.append(f'{mapping_path.parent.name}: {len(s)} 字')
        union |= s
    chars = sorted(union)
    lines = [''.join(chars[i:i + 50]) for i in range(0, len(chars), 50)]
    out.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    print(f'{len(chars)} 字を {out} に書き出しました（内訳: {", ".join(found) if found else "ROM 抽出データが見つからず"}）')


if __name__ == '__main__':
    main()
