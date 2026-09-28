# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "pillow>=10"]
# ///
"""法廷記録（証拠品・人物ファイル）の名前と説明文を、画像（record/name, record/desc）から読む。

    uv run tools/rom/record_text.py [出力（assets/extracted/tables/record_text.json）]
    uv run tools/rom/record_text.py --game aa2|aa3 [出力（<ゲームの置き場所>/tables/record_text.json）] [--reocr]

--game を付けると逆転裁判2・3 の絵を読む（record_text23.py。蘇る逆転の字形で引き、無い字形は文字認識）。

読み方: 絵を 1 字ずつの字形に切り分け（small_font_seg.py）、小さいフォントを作ったときの全字形の一覧
（font/small/glyphs.json。small_font.py が書き出す）から、点の並びが完全に同じ字形を引いて文字にする。
字形と文字の対応は small_font.py で決めたもの（文字認識の多数決 + 台本 + tools/rom/small_font_fixes.tsv の手直し）で、
字形ごとに直せば全部の項目に効く。場所ごとに直すもの（同じ字形が別の字に使われているなど）は
tools/rom/record_text_fixes.json に置く。確かめ方は record_text_check.py（フォントで描き直して元の絵と比べる）。

項目番号 → 名前・説明文の絵は evidence.json の image（tbl_record.py が法廷記録の表 0x020ab27c の +2 / +6 から作る）。
表の欄が空き（番号 0 のまま。tbl_record.blank_fields）の項目は絵が無いので、その欄は空の文字列にする
（両方とも空の項目は出力しない。第 5 話の 171〜191 など show_item でアイコンだけ出す項目）。
項目と名前の対応の確かめ方は record_text_verify.py（台本の「ファイルした」の文・3D の物のテクスチャなど）。

前提: 先に uv run tools/rom/small_font.py を実行しておく。
出力: {"items": {"番号": {"name": ..., "desc": ...}}}。変換（tools/convert/）は text_ja が無い項目にこれを使う。
人物ファイルの名前の「姓と名の間の空きマス」は半角の空白にする（text_ja と同じ）。ほかの空きマスは全角の空白。
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from record_glyphs import HERE, UNKNOWN, X, decode_line, items, load_fonts, record_lines  # noqa: E402

FIXES = os.path.join(HERE, 'record_text_fixes.json')


def read_fixes(path: str = FIXES) -> dict[tuple[int, str], list[tuple[int, int, str]]]:
    """(項目の番号, 'name' か 'desc') → [(行, 並びの番号, 文字)]。並びの番号は空きマスも数える"""
    if not os.path.exists(path):
        return {}
    data = json.load(open(path, encoding='utf-8'))['fixes']
    return {(int(k), field): [tuple(x) for x in v] for k, fields in data.items() for field, v in fields.items()}


def read_record(it: dict, lines: dict[str, list], fonts: dict, fixes: dict) -> tuple[dict[str, list[list[str]]], str]:
    """項目 1 つ: 欄 → 行ごとの字の並び（直し表を当てたもの）と、名前の種類（name / profile）"""
    out = {}
    kind = 'name'
    for field in ('name', 'desc'):
        rows = []
        for ln in lines.get(it[field], []):
            if field == 'name':
                kind = ln.kind
            rows.append(decode_line(ln, fonts[ln.kind]))
        for li, j, ch in fixes.get((it['id'], field), []):
            rows[li][j] = ch
        out[field] = rows
    return out, kind


def to_text(rows: list[list[str]], profile: bool = False) -> str:
    text = '\n'.join(''.join(r).rstrip('　') for r in rows).rstrip('\n')
    return text.replace('　', ' ') if profile else text


def main() -> None:
    if '--game' in sys.argv:
        from game import by_key
        from record_text23 import run
        k = sys.argv.index('--game')
        args = [a for i, a in enumerate(sys.argv[1:], 1) if i not in (k, k + 1) and not a.startswith('--')]
        run(by_key(sys.argv[k + 1]), args[0] if args else None, '--reocr' in sys.argv)
        return
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(X, 'tables', 'record_text.json')
    fonts = load_fonts()
    lines = record_lines()
    fixes = read_fixes()
    res, unknown = {}, []
    for it in items():
        rows, kind = read_record(it, lines, fonts, fixes)
        name, desc = to_text(rows['name'], kind == 'profile'), to_text(rows['desc'])
        if UNKNOWN in name + desc:
            unknown.append(it['id'])
        if name or desc:
            res[str(it['id'])] = {'name': name, 'desc': desc}
    about = ('法廷記録の名前と説明文（画像の字を小さいフォントの字形と完全一致で引いたもの。tools/rom/record_text.py、'
             '確かめ方は tools/rom/record_text_check.py）')
    with open(out, 'w', encoding='utf-8') as f:
        f.write(json.dumps({'_about': about, 'items': res}, ensure_ascii=False, indent=1) + '\n')
    print(f'{out}: {len(res)} 項目' + (f'（読めない字のある項目: {unknown}）' if unknown else ''))


if __name__ == '__main__':
    main()
