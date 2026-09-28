# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "pillow>=10"]
# ///
"""名札の絵（tbl_record.py が書き出した record/nametag/{ja,en}/NN.png）の文字を macOS の文字認識で読む（2・3 用）。

    uv run tools/rom/record_nametags.py <rom.nds> [--check]

名札には文字の表が無い（絵だけ）ので、絵を読む。読んだ結果は tools/rom/record_nametags.<ゲームコード>.json の ocr に書き、
目で見て直したものは同じ JSON の fixes（言語 → {絵の番号: 文字}）に置く（読み直しても fixes は残る）。
tbl_record.py は ocr に fixes を重ねたものを names.json の text にする。英語の名札が名前の呼び名、日本語の名札が表示名。
--check は JSON を書き換えず、読んだ結果と今の JSON（直しを当てたもの）の違いだけを出す。
読み方: 枠を除いた字の点（灰色の明るい色）を黒、ほかを白にして 6 倍に拡大・少しぼかし、tools/rom/ocr.swift（Vision、ja-JP）で読む。
前提: 先に tbl_record.py を実行しておく。macOS と swift。蘇る逆転の名札の文字は tbl_record.NAMETAG_TEXT（手で読んだもの）。
"""
import json
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from game import detect  # noqa: E402
from record_games import LAYOUTS  # noqa: E402

LANGS = ('ja', 'en')
#: 拡大率・余白・枠（上と左右の 2 点は枠の線なので除く）
SCALE, PAD, FRAME = 6, 8, 2


def ink_image(src: Path, dst: str) -> bool:
    """字の点を黒、ほかを白にした拡大画像を書く。字が無ければ False"""
    im = Image.open(src)
    pal = np.array(im.getpalette()[:48], np.int32).reshape(-1, 3)
    idx = np.array(im)
    rgb = pal[np.minimum(idx, len(pal) - 1)]
    ink = (rgb[..., 0] == rgb[..., 1]) & (rgb[..., 1] == rgb[..., 2]) & (rgb[..., 0] >= 100)
    ink = ink[FRAME:, FRAME:-FRAME]
    if not ink.any():
        return False
    out = np.full((ink.shape[0] + 2 * PAD, ink.shape[1] + 2 * PAD), 255, np.uint8)
    out[PAD:PAD + ink.shape[0], PAD:PAD + ink.shape[1]][ink] = 0
    img = Image.fromarray(out.repeat(SCALE, 0).repeat(SCALE, 1)).filter(ImageFilter.GaussianBlur(SCALE / 3))
    img.save(dst)
    return True


def clean(s: str, lang: str) -> str:
    """文字認識の結果をそろえる（日本語は全角、英語は半角。空白は英語だけ残す）"""
    s = unicodedata.normalize('NFKC', s).strip()
    if lang == 'ja':
        s = s.replace(' ', '').replace('?', '？').replace('-', 'ー').replace('一', 'ー')
    return s


def read(root: Path, counts: dict[str, int]) -> dict[str, list[str]]:
    out = {lang: [''] * counts[lang] for lang in LANGS}
    with tempfile.TemporaryDirectory() as td:
        jobs = {}
        for lang in LANGS:
            for m in range(counts[lang]):
                q = f'{td}/{lang}_{m:02}.png'
                if ink_image(root / 'record' / 'nametag' / lang / f'{m:02}.png', q):
                    jobs[q] = (lang, m)
        res = subprocess.run(['swift', str(HERE / 'ocr.swift'), *jobs], capture_output=True, text=True, check=True).stdout
    cur = None
    for line in res.splitlines():
        if line.startswith('# '):
            cur = jobs.get(line[2:])
        elif cur is not None and '\t' in line:
            lang, m = cur
            out[lang][m] += line.split('\t', 1)[1]
    return {lang: [clean(s, lang) for s in v] for lang, v in out.items()}


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        sys.exit(__doc__)
    game = detect(Path(args[0]).read_bytes())
    lay = LAYOUTS[game.code]
    path = HERE / f'record_nametags.{game.code}.json'
    doc = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
    fixes = doc.get('fixes', {lang: {} for lang in LANGS})
    got = read(game.out, lay.nametag_count)
    for lang in LANGS:
        for m, s in enumerate(got[lang]):
            final = fixes.get(lang, {}).get(str(m), s)
            old = doc.get('ocr', {}).get(lang, [])
            mark = ' ←直し' if final != s else ''
            if '--check' in sys.argv and m < len(old) and old[m] != s:
                mark += f'（前の読み {old[m]!r}）'
            print(f'{lang} {m:2}  {s!r}{mark}' + (f' → {final!r}' if mark else ''))
    if '--check' in sys.argv:
        return
    out = {'_about': '名札の絵の番号 → 文字。ocr = tools/rom/record_nametags.py で読んだもの、fixes = 目で見て直したもの（言語 → {絵の番号: 文字}）',
           'ocr': got, 'fixes': fixes}
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'→ {path}')


if __name__ == '__main__':
    main()
