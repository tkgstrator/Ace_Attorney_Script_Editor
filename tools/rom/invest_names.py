"""探偵パートの場所・話題の名前のテクスチャを文字で読む（tbl_invest.py --ocr から使う）。

名前は絵（128×32 のテクスチャ）でしか持っていないので、macOS の文字認識（tools/rom/ocr.swift）で読む。
読み違いは 2 段で直す:
  - OCR_FIX: どのゲームでも起きる読み違い（文字列の置き換え）
  - tools/rom/invest_names_fixes.<ゲームコード>.json: 絵を目で見て確かめた、番号ごとの直し
    （{"places": {"番号": "名前"}, "topics": {...}}。文字認識の結果と違うものだけ載せる）
"""
import json
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent

#: 文字認識のよくある読み違い（蘇る逆転の場所の名前で確認したもの）
OCR_FIX = [('營', '警'), ('管察', '警察'), ('撮景・', '撮影所・')]


def ocr(pngs: list[str]) -> dict[str, str]:
    """白地に 3 倍に拡大して ocr.swift で読む（読めなければ空）"""
    from PIL import Image
    res: dict[str, str] = {}
    with tempfile.TemporaryDirectory() as td:
        paths = []
        for i, p in enumerate(pngs):
            im = Image.open(ROOT / p).convert('RGBA')
            bg = Image.new('RGBA', im.size, 'white')
            bg.alpha_composite(im)
            q = f'{td}/{i}.png'
            bg.convert('RGB').resize((im.width * 3, im.height * 3)).save(q)
            paths.append(q)
        out = subprocess.run(['swift', str(HERE / 'ocr.swift'), *paths], capture_output=True, text=True, check=False).stdout
        cur = None
        for line in out.splitlines():
            if line.startswith('# '):
                cur = pngs[int(Path(line[2:]).stem)]
                res[cur] = ''
            elif cur is not None and '\t' in line:
                res[cur] += line.split('\t', 1)[1].replace(' ', '')
    for k, v in res.items():
        for a, b in OCR_FIX:
            v = v.replace(a, b)
        res[k] = v.rstrip('。')
    return res


def read_fixes(code: str) -> dict[str, dict[int, str]]:
    """番号ごとの直し（無ければ空）"""
    p = HERE / f'invest_names_fixes.{code}.json'
    if not p.exists():
        return {'places': {}, 'topics': {}}
    j = json.loads(p.read_text())
    return {k: {int(i): v for i, v in j.get(k, {}).items()} for k in ('places', 'topics')}


def read_names(names: dict, code: str) -> None:
    """names（tbl_invest.py の places・topics）の日本語の絵を読み、name_ocr に入れる（直しを当てた後の名前）"""
    pngs = [e['ja']['png'] for k in ('places', 'topics') for e in names[k] if e['ja']['png']]
    got = ocr(pngs)
    fixes = read_fixes(code)
    for k in ('places', 'topics'):
        for e in names[k]:
            e['name_ocr'] = fixes[k].get(e['id'], got.get(e['ja']['png']))
