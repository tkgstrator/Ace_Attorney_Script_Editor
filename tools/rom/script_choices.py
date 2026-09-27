"""選択肢（台本 8 / 9）の文。台本には無く、下画面のボタンの絵（テクスチャ）になっている。

ARM9 0x0203a7e0（下画面の選択肢の準備）で確認した表:
  - 0x020b4b74: 6 バイト × 200 行 {u8 パート, u8 0, u16 区画 + 128, u8 並べ方, u8 0}。
    (パート = game+0x69, 今の区画 = 文脈 +0x4a) が一致する行を探す（無ければ 0 行目）
  - 0x020b5024（日本語）/ 0x020b54d4（英語）: 同じ行の u16 × 3 = 選択肢ごとのテクスチャの番号（0xffff = 無し）
  - テクスチャ: data.bin 0x25cf5e4（日本語）/ 0x263bf4c（英語）のパックの番号（ex_tail.py の data/tail/packs/<位置>/NNNN.png）

文字は macOS の文字認識（tools/rom/ocr.swift）で読む（推測。読み違いは FIXES で直す）。日本語は、choice_text.py が
読んで確かめた表（tables/choice_text.json。直し表 tools/rom/choice_text_fixes.json を当て、ほかの絵の字形で描き直して
確かめたもの）があれば、そちらを使う。
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = Path(__file__).resolve().parents[2]
ROWS, ROW_TABLE = 200, 0x020b4b74
TEX_TABLE = {'ja': 0x020b5024, 'en': 0x020b54d4}
PACK = {'ja': '25cf5e4', 'en': '263bf4c'}
#: 文字認識のよくある読み違い
FIXES = [('毆', '殴'), ('殿ら', '殴ら'), ('問き', '聞き')]


def rows(a9, lang: str) -> list[dict]:
    """表の全行（パート, 区画, 並べ方, テクスチャの番号）"""
    out = []
    for r in range(ROWS):
        a = ROW_TABLE + r * 6
        tex = [a9.u16(TEX_TABLE[lang] + r * 6 + k * 2) for k in range(3)]
        out.append({'row': r, 'part': a9.u8(a), 'section': a9.u16(a + 2) - 128, 'layout': a9.u8(a + 4),
                    'textures': [t for t in tex if t != 0xFFFF]})
    return out


def png(lang: str, tex: int) -> Path:
    return ROOT / f'assets/extracted/data/tail/packs/{PACK[lang]}/{tex:04}.png'


def ocr(paths: list[Path]) -> dict[Path, str]:
    """白地に 3 倍に拡大して ocr.swift で読む（読めなければ空）"""
    from PIL import Image
    res: dict[Path, str] = {}
    with tempfile.TemporaryDirectory() as td:
        tmp = []
        for i, p in enumerate(paths):
            im = Image.open(p).convert('RGBA')
            bg = Image.new('RGBA', im.size, 'white')
            bg.alpha_composite(im)
            q = f'{td}/{i}.png'
            bg.convert('RGB').resize((im.width * 3, im.height * 3)).save(q)
            tmp.append(q)
        out = subprocess.run(['swift', str(ROOT / 'tools/rom/ocr.swift'), *tmp], capture_output=True, text=True).stdout
        cur = None
        for line in out.splitlines():
            if line.startswith('# '):
                cur = paths[int(Path(line[2:]).stem)]
                res[cur] = ''
            elif cur is not None and '\t' in line:
                res[cur] += line.split('\t', 1)[1]
    for k, v in res.items():
        for a, b in FIXES:
            v = v.replace(a, b)
        res[k] = v.strip()
    return res


def choices_for(a9, part: int, lang: str, sections: set[int], use_ocr: bool) -> dict[str, dict]:
    """その話の選択肢: 区画 → {textures, png, text}"""
    picked = {r['section']: r for r in rows(a9, lang) if r['part'] == part and r['section'] in sections}
    texts: dict[Path, str] = {}
    if use_ocr:
        paths = [png(lang, t) for r in picked.values() for t in r['textures'] if png(lang, t).exists()]
        texts = ocr(sorted(set(paths))) if paths else {}
    checked = ROOT / 'assets/extracted/tables/choice_text.json'
    if lang == 'ja' and checked.exists():
        for k, v in json.loads(checked.read_text(encoding='utf-8'))['items'].items():
            texts[png(lang, int(k))] = v
    out = {}
    for s, r in sorted(picked.items()):
        out[str(s)] = {
            'row': r['row'], 'layout': r['layout'], 'textures': r['textures'],
            'png': [str(png(lang, t).relative_to(ROOT)) for t in r['textures']],
            'text': [texts.get(png(lang, t)) for t in r['textures']],
        }
    return out
