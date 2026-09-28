# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow>=10"]
# ///
"""法廷記録の人物ファイルを、話し手（名前の番号 = 命令 14 name）に結び付ける（2・3 用）。

    uv run tools/rom/record_profiles.py <rom.nds>

書き出すもの: tables/profiles.json  法廷記録の番号 → {name_en: 英語の名前, name_id: 名前の番号（無ければ null）}

結び付け方（ROM の表だけを使う）:
  - 法廷記録の表（tbl_record.py の evidence.json）の name_index.en = 英語の名前の絵の番号（record/name/en/NNN.png）。
    同じ人物の人物ファイル（話が進んで説明が変わったもの）は同じ絵の番号を持つ。
  - 英語の名前の絵を macOS の文字認識（tools/rom/ocr.swift）で読む（例「Maya Fey」）。
  - 名札の表（names.json の text.en。英語の名札 = 呼び名、例「Maya」）の語の並びが、名前の語の並びに続けて含まれれば
    その名札の人物。いくつも合えば長い名札（語の多いもの）、同じ名札の番号がいくつもあれば小さい番号（主な名前）。
  日本語の名前（「綾里 真宵」）と名札（「マヨイ」）には共通の文字が無いので、英語どうしで引く。
  読み違い・結び付けの直しは tools/rom/record_profiles_fixes.<ゲームコード>.json（絵の番号 → 名前の番号 / null）。
前提: 先に tbl_record.py と record_nametags.py を実行しておく。macOS と swift。
"""
import json
import re
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from game import detect  # noqa: E402

SCALE = 4


def ocr(paths: dict[int, Path]) -> dict[int, str]:
    """英語の名前の絵（暗い地に明るい字）を白地に黒い字にして拡大し、1 行の文字にする"""
    out: dict[int, str] = {}
    with tempfile.TemporaryDirectory() as td:
        jobs: dict[str, int] = {}
        for n, p in paths.items():
            im = Image.open(p).convert('RGBA')
            gray = Image.new('L', im.size, 255)
            px, g = im.load(), gray.load()
            for y in range(im.height):
                for x in range(im.width):
                    r, gg, b, a = px[x, y]
                    # 字の点（明るい色）を黒に
                    if a and r + gg + b > 300:
                        g[x, y] = 0
            q = f'{td}/{n:03}.png'
            gray.resize((im.width * SCALE, im.height * SCALE), Image.LANCZOS).save(q)
            jobs[q] = n
        res = subprocess.run(['swift', str(HERE / 'ocr.swift'), *jobs], capture_output=True, text=True, check=True).stdout
    cur = None
    for line in res.splitlines():
        if line.startswith('# '):
            cur = jobs.get(line[2:])
            if cur is not None:
                out[cur] = ''
        elif cur is not None and '\t' in line:
            out[cur] = (out[cur] + ' ' + line.split('\t', 1)[1]).strip()
    return out


def words(s: str) -> list[str]:
    """比べるための語の並び（小文字・アクセントを外す。☆ などの記号は区切り）"""
    s = unicodedata.normalize('NFKD', s)
    s = ''.join(c for c in s if not unicodedata.combining(c)).lower()
    return [w for w in re.split(r"[^a-z0-9'.-]+", s) if w]


def contains(name: list[str], tag: list[str]) -> bool:
    return bool(tag) and any(name[i:i + len(tag)] == tag for i in range(len(name) - len(tag) + 1))


def match(name_en: str, tags: list[tuple[int, str]]) -> int | None:
    """英語の名前 → 名前の番号（名札の語の並びが名前に続けて含まれるもの。長い名札、小さい番号を先に）"""
    nw = words(name_en)
    hits = [(len(words(t)), -i) for i, t in tags if contains(nw, words(t))]
    return -max(hits)[1] if hits else None


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        sys.exit(__doc__)
    game = detect(Path(args[0]).read_bytes())
    t = game.out / 'tables'
    items = json.loads((t / 'evidence.json').read_text())['items']
    names = json.loads((t / 'names.json').read_text())['names']
    # 名札の英語（「？？？」などの名前でないもの・名札の無いものは除く）
    tags: list[tuple[int, str]] = []
    for n in names:
        for s in (n['text']['en'], (n.get('en_swap') or {}).get('text', '')):
            if s and words(s) and n['text']['ja'] and not s.startswith('?'):
                tags.append((n['id'], s))
    fx_path = HERE / f'record_profiles_fixes.{game.code}.json'
    fixes = json.loads(fx_path.read_text())['name_image'] if fx_path.exists() else {}
    imgs = sorted({it['name_index']['en'] for it in items if it['name_index']['en'] is not None})
    read = ocr({m: game.out / 'record' / 'name' / 'en' / f'{m:03}.png' for m in imgs})
    out = {}
    for it in items:
        m = it['name_index']['en']
        if m is None:
            continue
        name_en = read.get(m, '')
        nid = fixes[str(m)] if str(m) in fixes else match(name_en, tags)
        out[str(it['id'])] = {'name_image': m, 'name_en': name_en, 'name_id': nid}
    meta = {
        '_about': '法廷記録の番号 → 英語の名前（record/name/en の絵を文字認識で読んだもの）と、名札の英語が語の並びとして'
                  '含まれる名前の番号（命令 14 name。無ければ null）。tools/rom/record_profiles.py',
    }
    (t / 'profiles.json').write_text(json.dumps({**meta, 'items': out}, ensure_ascii=False, indent=1) + '\n')
    for k, v in out.items():
        if it_is_profile(items, int(k)):
            print(f"{k:>4} {v['name_image']:>3} {v['name_en']!r:32} → {v['name_id']}")
    print(f'→ {t / "profiles.json"}')


def it_is_profile(items: list[dict], rec: int) -> bool:
    return any(it['id'] == rec and it.get('start_as') != 'evidence' for it in items)


if __name__ == '__main__':
    main()
