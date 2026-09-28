"""公式（DS 版の蘇る逆転・2・3）の画像アセットの仕様（大きさ・色数・形式・置き方）を種類ごとに測る。

    uv run python tools/assets/measure.py                 # 3 作品を測って tools/assets/official-assets.json に書く
    uv run python tools/assets/measure.py --games aa1     # 一部だけ（書き出し先は同じ。ほかの作品の値は残す）
    uv run python tools/assets/measure.py --print         # 書かずに表示だけ

入力（手元だけにあり、配布しない）:
  assets/roms/*.nds（読むだけ）と、tools/rom の抽出物 assets/extracted/（蘇る逆転）・aa2/・aa3/ の tables・PNG・台本
出力: 数値だけの JSON（絵・台詞・名前は含まない）。説明は docs/official-assets.md。

種類ごとの計測は m_bg.py（背景・パン・机）、m_obj.py（人物のパックの OBJ: 立ち絵・吹き出し・カットイン・重ね絵・錠）、
m_record.py（法廷記録・名札・下画面の UI・3D のテクスチャ）、m_font.py（フォント）。
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from common import GAMES, ROOT, load_game  # noqa: E402  （tools/rom を読み込み先に足すので最初に）

import m_bg  # noqa: E402
import m_font  # noqa: E402
import m_obj  # noqa: E402
import m_record  # noqa: E402

OUT = ROOT / 'tools/assets/official-assets.json'
ABOUT = ('公式（DS 版）の画像アセットの計測値（数値のみ）。uv run python tools/assets/measure.py で作り直せる。'
         '説明は docs/official-assets.md')


def measure_game(key: str) -> dict:
    g = load_game(key)
    out = {'code': g.A.code}
    for name, mod in (('bg', m_bg), ('obj', m_obj), ('record', m_record), ('font', m_font)):
        t0 = time.time()
        out[name] = mod.measure(g)
        print(f'  {key} {name}: {time.time() - t0:.1f} 秒', file=sys.stderr)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description='公式の画像アセットの仕様を測る')
    ap.add_argument('--games', default=','.join(GAMES), help='測る作品（aa1,aa2,aa3）')
    ap.add_argument('--out', type=Path, default=OUT)
    ap.add_argument('--print', action='store_true', help='書かずに表示する')
    args = ap.parse_args()
    keys = [k for k in args.games.split(',') if k]
    prev = json.loads(args.out.read_text()) if args.out.exists() and not args.print else {}
    games = prev.get('games', {})
    for k in keys:
        games[k] = measure_game(k)
    doc = {'_about': ABOUT, 'games': {k: games[k] for k in GAMES if k in games}}
    text = json.dumps(doc, ensure_ascii=False, indent=1) + '\n'
    if args.print:
        print(text)
        return
    args.out.write_text(text, encoding='utf-8')
    print(f'書きました: {args.out.relative_to(ROOT)}')


if __name__ == '__main__':
    main()
