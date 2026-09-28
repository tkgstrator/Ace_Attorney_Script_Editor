# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow>=10"]
# ///
"""台本（mes_all.bin）の項目を、変換（tools/convert/）で読むための JSON に書き出す。

    uv run tools/rom/script_json.py <rom.nds または mes_all.bin> [項目の番号…] [--out assets/extracted/script/json] [--ocr]
    例: uv run tools/rom/script_json.py assets/roms/GYAKUTEN_YOM_AGYJ08_00.nds 0 72 --ocr

2・3 の ROM も読める（ゲームコードで見分ける。game.py）。出力先の既定は assets/extracted/aa2/script/json・aa3/script/json。

--ocr: 選択肢の文（下画面のボタンの絵）を macOS の文字認識で読む（script_choices.py。ROM を渡したときだけ）。

項目を省くと全部。出力は NNN.json（ROM の文を含むので、手元用・配布しない）:

    {
      "entry": 0, "lang": "ja", "sections": 114,
      "labels": {"114": {"section": 84, "offset": 2}, ...},     # 見出しの末尾のラベル（tables/labels.json と同じ）
      "body": [                                                 # 区画ごと（ラベルの分は含めない）
        {"section": 0, "ops": [
          {"at": 0, "op": 0, "name": "nop", "args": []},
          {"at": 2, "op": "text", "text": "‥‥はあ‥‥"},            # 文（フォントの番号を文字にしたもの）
          {"at": 40, "op": 54, "name": "jump", "args": [114], "target": {"section": 84, "offset": 2}},
          {"at": 60, "op": 44, "name": "next_clear", "args": [211], "targets": [{"section": 83, "offset": 0}]},
          ...
        ]}
      ],
      "choices": {"3": {"textures": [0, 1, 2], "png": [...], "text": ["…", …]}, ...}   # ROM を渡したときだけ
    }

- at は区画の先頭からのバイト位置（53 のバイト位置の飛び先・ラベルの offset と同じ単位）。
- target / targets は飛び先を解いたもの（target = ラベル → 区画と位置、targets = 「区画 + 128」の引数 → 区画）。
  53 でバイト位置へ飛ぶものは target.section = null（今の区画）。
- 命令の名前は tables/opcodes.json（無ければ script_format.py）。
"""
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from charset import CODE_BASE  # noqa: E402
from script_dump import entries, load_chars, read_mes  # noqa: E402
from game import GAMES, detect_path  # noqa: E402
from script_format import ARGC, OPCODES  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
TABLES = ROOT / 'assets/extracted/tables'

#: 引数が「区画 + 128」の命令と、その引数の位置
SECTION_ARGS: dict[int, tuple[int, ...]] = {
    8: (0, 1), 9: (0, 1, 2), 10: (0,), 15: (0,), 32: (0,), 42: (1, 2), 44: (0,), 111: (0,),
}
#: 引数がラベル（見出しの添字）の命令
LABEL_ARGS = {54: 0, 120: 0, 122: 0}


def op_names(tables: Path = TABLES) -> dict[int, str]:
    names = {k: v[0] for k, v in OPCODES.items()}
    p = tables / 'opcodes.json'
    if p.exists():
        names.update({int(k): v['name'] for k, v in json.loads(p.read_text(encoding='utf-8')).items()})
    return names


def split_labels(entry: list[int]) -> tuple[list[list[int]], dict[str, dict]]:
    """区画とラベルに分ける（tbl_script.py の split_header と同じ判定）。
    見出しのうち、位置が増えていき、そこの語が 0（nop）のものが区画。残りの末尾がラベル（区画 << 16 | バイト位置）。

    3 の分割された項目（004 など）は見出しが前の項目の写しで、先頭の数個だけが本物の区画。
    残りは古い値なので、区画の範囲に入らないものはラベルとしても捨てる（stale）"""
    n = entry[0] | entry[1] << 16
    heads = [entry[2 + 2 * i] | entry[3 + 2 * i] << 16 for i in range(n)]
    size = len(entry) * 2
    k = 0
    while k < n and heads[k] < size and (k == 0 or heads[k] > heads[k - 1]) and entry[heads[k] // 2] == 0:
        k += 1
    offs = [h // 2 for h in heads[:k]] + [len(entry)]
    secs = [entry[offs[i]:offs[i + 1]] for i in range(k)]
    labels = {str(i): {'section': heads[i] >> 16, 'offset': heads[i] & 0xFFFE} for i in range(k, n)}
    bad = [i for i, v in labels.items() if v['section'] >= k or v['offset'] >= len(secs[v['section']]) * 2]
    if bad and len(bad) < len(labels) // 2:
        raise AssertionError(f'ラベルの区画が範囲外: {bad[:5]}')
    for i in bad:
        del labels[i]
    return secs, labels


def decode_section(s: list[int], chars: dict[int, str], names: dict[int, str],
                   labels: dict[str, dict], argc: dict[int, int] = ARGC) -> list[dict]:
    out: list[dict] = []
    i = 0
    while i < len(s):
        w = s[i]
        if w >= CODE_BASE:
            j = i
            while j < len(s) and s[j] >= CODE_BASE:
                j += 1
            txt = ''.join(chars.get(g - CODE_BASE, f'{{{g - CODE_BASE}}}') for g in s[i:j])
            out.append({'at': i * 2, 'op': 'text', 'text': txt})
            i = j
            continue
        n = argc.get(w, 0)
        args = list(s[i + 1:i + 1 + n])
        o: dict = {'at': i * 2, 'op': w, 'name': names.get(w, f'op{w}'), 'args': args}
        if w in SECTION_ARGS:
            o['targets'] = [{'section': args[k] - 128, 'offset': 0} if args[k] >= 128 else None for k in SECTION_ARGS[w]]
        if w in LABEL_ARGS:
            o['target'] = labels.get(str(args[LABEL_ARGS[w]]))
        if w == 53:
            if args[0] & 0x80:
                o['target'] = labels.get(str(args[1]))
            else:
                o['target'] = {'section': None, 'offset': args[1] & ~1}
        out.append(o)
        i += 1 + n
    return out


def export(entry: list[int], idx: int, chars: dict[int, str], names: dict[int, str], a9=None, use_ocr=False,
           game=None) -> dict:
    g = game or GAMES['AGYJ']
    secs, labels = split_labels(entry)
    body = [{'section': k, 'ops': decode_section(s, chars, names, labels, g.argc)} for k, s in enumerate(secs)]
    lang = 'en' if idx % 2 else 'ja'
    out = {'entry': idx, 'lang': lang, 'sections': len(secs), 'labels': labels, 'body': body}
    if a9 is not None and g.code == 'AGYJ':
        from script_choices import choices_for
        with_choice = {b['section'] for b in body if any(o['op'] in (8, 9) for o in b['ops'])}
        out['choices'] = choices_for(a9, idx // 2, lang, with_choice, use_ocr) if with_choice else {}
    return out


def main() -> None:
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    out = None
    if '--out' in args:
        k = args.index('--out')
        out = Path(args[k + 1])
        del args[k:k + 2]
    use_ocr = '--ocr' in args
    args = [a for a in args if a != '--ocr']
    src, picks = args[0], [int(a) for a in args[1:]]
    g = detect_path(src)
    out = out or g.script / 'json'
    a9 = None
    if src.endswith('.nds'):
        from arm9 import Arm9
        a9 = Arm9(open(src, 'rb').read())
    out.mkdir(parents=True, exist_ok=True)
    chars, names = load_chars(g), op_names(g.tables)
    ents = entries(read_mes(src))
    for i in picks or range(len(ents)):
        data = export(ents[i], i, chars, names, a9, use_ocr, g)
        (out / f'{i:03}.json').write_text(json.dumps(data, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'{len(picks) or len(ents)} 項目を {out} に書き出しました')


if __name__ == '__main__':
    main()
