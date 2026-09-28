# /// script
# dependencies = ["numpy", "pillow"]
# ///
"""DS 版の人物ごとに、動きの数・コマの数・色数（パレット）を数え、出番の多さの段ごとにまとめる。

    uv run tools/sprites/measure_chars.py [--json tools/sprites/official-chars.json]

measure_official.py と同じ入力を使う（手元だけにあり、配布しない）。
出力は統計だけで、人物の名前や番号は含まない。

段（出番の多さ = その人物の動きが台本で使われる回数の合計）:
  main    5000 回以上（弁護士・検事・裁判長・助手など、毎話出る人物）
  witness 500〜4999 回（証人・その話の中心になる人物）
  minor   500 回未満（端役・1 場面だけの人物）
"""
import json
import sys
from pathlib import Path

from measure_official import GAMES, ROOT, measure_game, stats

TIERS = (('main', 5000), ('witness', 500), ('minor', 0))
#: DS の OBJ の 4bpp パレット（透明を除く色の数）
PAL = 15


def palettes(file_colors: list[set[int]]) -> int:
    """ファイル（絵の束）ごとの色の集合から、15 色のパレットが最低いくつ要るかの目安（貪欲にまとめる）"""
    groups: list[set[int]] = []
    for cs in sorted(file_colors, key=len, reverse=True):
        for i in range(0, max(1, len(cs)), PAL):
            part = set(sorted(cs)[i:i + PAL])
            for g in groups:
                if len(g | part) <= PAL:
                    g |= part
                    break
            else:
                groups.append(set(part))
    return len(groups)


def per_char(game: str, base: Path, m: dict) -> list[dict]:
    chars = json.loads((base / 'tables/chars.json').read_text())['chars']
    out = []
    for c in chars.values():
        recs = [m['by_aid'][str(a)] for a in c.get('anims', []) if str(a) in m['by_aid']]
        if not recs:
            continue
        uses = sum(r['uses'] for r in recs)
        kinds = [r['kind'] for r in recs]
        files: dict[str, set[int]] = {}
        for r in recs:
            files.setdefault(r['file'], set()).update(r['colors'])
        frames = set().union(*(r['frames'] for r in recs))
        tier = next(t for t, lo in TIERS if uses >= lo)
        out.append({
            'game': game, 'tier': tier, 'uses': uses,
            'anims': len(recs), 'anims_used': sum(r['uses'] > 0 for r in recs),
            'idle': kinds.count('idle'), 'talk': kinds.count('talk'),
            'special': kinds.count('special'), 'static': kinds.count('other'),
            'frames': len(frames), 'files': len(files),
            'colors': len(set().union(*files.values())),
            'colors_per_file_max': max(len(v) for v in files.values()),
            'palettes_est': palettes(list(files.values())),
        })
    return out


def summarize(rows: list[dict]) -> dict:
    keys = ('anims', 'anims_used', 'idle', 'talk', 'special', 'static', 'frames', 'files', 'colors',
            'colors_per_file_max', 'palettes_est')
    return {'chars': len(rows), **{k: stats(r[k] for r in rows) for k in keys},
            'files_le_15_colors': sum(r['colors_per_file_max'] <= PAL for r in rows) / max(1, len(rows))}


def main() -> None:
    args = sys.argv[1:]
    out_json = args[args.index('--json') + 1] if '--json' in args else None
    rows = []
    for game, rel in GAMES.items():
        base = ROOT / rel
        if (base / 'tables/char_anims.json').exists():
            rows += per_char(game, base, measure_game(game, base))
    if not rows:
        sys.exit('assets/extracted に取り出したデータがありません')
    result = {
        '_about': '公式の人物ごとの動き・コマ・色の数（統計のみ）。uv run tools/sprites/measure_chars.py で作り直せる',
        'tiers': {t: lo for t, lo in TIERS},
        'all': summarize(rows),
        'per_game': {g: summarize([r for r in rows if r['game'] == g]) for g in GAMES},
        'per_tier': {t: summarize([r for r in rows if r['tier'] == t]) for t, _ in TIERS},
        'per_game_tier': {f'{g}/{t}': summarize([r for r in rows if r['game'] == g and r['tier'] == t])
                          for g in GAMES for t, _ in TIERS},
    }
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if out_json:
        Path(out_json).write_text(text + '\n')
    for name, s in [('all', result['all']), *result['per_tier'].items()]:
        print(f"{name:8} 人数 {s['chars']:3}  動き {s['anims']['median']:>5} ({s['anims']['min']}〜{s['anims']['max']})"
              f"  使う動き {s['anims_used']['median']:>5}  コマ {s['frames']['median']:>5} ({s['frames']['max']})"
              f"  待機 {s['idle']['median']} 口パク {s['talk']['median']} 特有 {s['special']['median']}"
              f"  色 {s['colors']['median']} ({s['colors']['max']})  パレット {s['palettes_est']['median']}")


if __name__ == '__main__':
    main()
