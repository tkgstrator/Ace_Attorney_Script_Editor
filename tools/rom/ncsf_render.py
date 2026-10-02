# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy"]
# ///
"""SDAT の SSEQ を NCSF（DS の音源ドライバーを逆コンパイルしたもの）で WAV にする（プレイヤーの「DS（原音）」）。

    uv run tools/rom/ncsf_render.py --ncsf ~/src/NCSF                 # 蘇る逆転
    uv run tools/rom/ncsf_render.py --ncsf ~/src/NCSF --game aa2      # 逆転裁判2（aa3 も同じ）
    uv run tools/rom/ncsf_render.py --ncsf ~/src/NCSF --only BGM013,SE010

前もって要るもの:
    - .NET 10 SDK（dotnet。PATH に無ければ --dotnet で渡す）
    - NCSF（https://github.com/CyberBotX/NCSF、MIT）を手元に clone したもの。リポジトリの中には置かない
    - sseq_render.py の出力（<取り出し先>/sound/rendered/index.json）。名前・番号・長さ・ループの位置をそこから取る

NCSF の再生部（NCSFPlayer。pret の Pokémon Diamond の逆コンパイルにある NITRO の SND ドライバーを C# にしたもの）を
tools/rom/ncsf_render/（小さな C# の道具）から呼ぶ。NCSF に付いてくる NCSF123 は使わない。NCSF123 は
1 フレーム（5.2 ms）を 171 サンプルに丸めてテンポが 0.3% 遅れ、フェードや音量の補正もかかるため。
ここでは sseq_render.py と同じく 1 フレーム = 170.5 サンプル、32728 Hz・16 ビット ステレオ・補間なしで書き出す。

長さは sseq_render.py の出力と同じサンプル数（ループする曲は「前奏 + ループ 2 回」）。
ループの位置も sseq_render.py の値を使う。テンポの進み方は同じだが、NCSF は音が 1 フレーム早く出るので、
前後 400 サンプルの中で継ぎ目の差が最も小さくなる位置に合わせ直す（loop.shift・endShift。fit_loop を参照）。

出力: <取り出し先>/sound/ncsf/  bgm/<名前>.wav、se/<名前>.wav、index.json（sound/rendered/index.json と同じ形）
"""
import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
TOOL = Path(__file__).resolve().parent / 'ncsf_render' / 'NcsfRender.csproj'
GAME_ROOT = {
    'aa1': ROOT / 'assets/extracted',
    'aa2': ROOT / 'assets/extracted/aa2',
    'aa3': ROOT / 'assets/extracted/aa3',
}
RATE = 32728
SEARCH = 400      # ループの位置を合わせ直す幅（サンプル）
SEAM = 4096       # 継ぎ目の差を比べる長さ（サンプル）
SEAM_NEAR = 256   # そのうち、戻った直後として特に見る長さ
END_SHIFTS = (0, -1, 1, -170, -171, 170, 171)


def build(ncsf: Path, dotnet: str) -> Path:
    """道具をビルドする（出力は NCSF の clone の中の .ncsf-render-build/。リポジトリには作らない）"""
    art = ncsf / '.ncsf-render-build'
    subprocess.run([dotnet, 'build', str(TOOL), '-c', 'Release', f'-p:NcsfDir={ncsf}',
                    '--artifacts-path', str(art), '-v', 'q', '-nologo'], check=True)
    dll = next(art.glob('bin/NcsfRender/release*/NcsfRender.dll'), None)
    if dll is None:
        sys.exit(f'ビルドした NcsfRender.dll が {art} に見つかりません')
    return dll


def read_wav(p: Path) -> np.ndarray:
    with wave.open(str(p)) as w:
        a = np.frombuffer(w.readframes(w.getnframes()), dtype='<i2')
    return a.reshape(-1, 2).astype(np.float64) / 32768


def fit_loop(mono: np.ndarray, start: int, end: int):
    """start・end を同じだけずらして（end だけ 1 サンプル・1 フレームずらすことも試す。sseq_render.py の
    choose_loop と同じ候補）、継ぎ目の差が最も小さい所を探す。差は、継ぎ目の直後 SEAM_NEAR サンプルの差の最大
    （戻った瞬間のぷつっという音）を主に、SEAM サンプルの差の最大を従に見る。差がほぼ同じなら、ずらしの小さい方を取る。
    戻り値は (直後の差の最大, start のずらし, end のずらし, SEAM サンプルの差の RMS)"""
    found = []
    for de in END_SHIFTS:
        for d in range(-SEARCH, SEARCH + 1):
            s, e = start + d, end + d + de
            if s < 0 or e + SEAM > len(mono):
                continue
            diff = np.abs(mono[s:s + SEAM] - mono[e:e + SEAM])
            near = float(diff[:SEAM_NEAR].max())
            found.append((near + 0.25 * float(diff.max()), near, d, d + de, float(np.sqrt((diff ** 2).mean()))))
    if not found:
        return 0.0, 0, 0, 0.0
    least = min(f[0] for f in found)
    best = min((f for f in found if f[0] <= least + 1e-4), key=lambda f: abs(f[2]) + abs(f[3]))
    return best[1:]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ncsf', default=os.environ.get('NCSF_DIR'), help='NCSF を clone した場所（既定は $NCSF_DIR）')
    ap.add_argument('--dotnet', default=os.environ.get('DOTNET', shutil.which('dotnet') or 'dotnet'))
    ap.add_argument('--game', choices=sorted(GAME_ROOT), default='aa1')
    ap.add_argument('--only', help='名前（SYMB）かシーケンスの番号をカンマ区切りで')
    args = ap.parse_args()
    if not args.ncsf or not (Path(args.ncsf) / 'NCSFPlayer').is_dir():
        sys.exit('--ncsf に NCSF を clone した場所を渡してください（git clone https://github.com/CyberBotX/NCSF）')
    base = GAME_ROOT[args.game]
    sdat = base / 'files/sound_data.sdat'
    ref = json.loads((base / 'sound/rendered/index.json').read_text())
    out = base / 'sound/ncsf'
    items = ref['items']
    if args.only:
        want = {w.strip() for w in args.only.split(',')}
        items = [i for i in items if i['name'] in want or str(i['sdatIndex']) in want]

    dll = build(Path(args.ncsf).resolve(), args.dotnet)
    with tempfile.TemporaryDirectory() as tmp:
        jobs = Path(tmp) / 'jobs.tsv'
        jobs.write_text(''.join(f"{i['sdatIndex']}\t{i['samples']}\t{out / i['wav']}\n" for i in items))
        run = subprocess.run([args.dotnet, str(dll), str(sdat), str(jobs)], check=True,
                             capture_output=True, text=True)
    skipped = {int(line.split('\t')[0]) for line in run.stdout.splitlines() if '\tskip\t' in line}

    results = []
    for it in items:
        if it['sdatIndex'] in skipped:
            print(f"  {it['category']}/{it['name']}: NCSF で読めないので飛ばします")
            continue
        audio = read_wav(out / it['wav'])
        peak = float(np.abs(audio).max()) if len(audio) else 0.0
        r = {k: it[k] for k in ('name', 'category', 'sdatIndex', 'fileId', 'bank', 'volume', 'player', 'wav',
                                'scriptId', 'scriptUses') if k in it}
        r.update(sampleRate=RATE, samples=len(audio), duration=len(audio) / RATE, peak=peak,
                 clipped=int((np.abs(audio) >= 32767 / 32768).any(axis=1).sum()), usesRandom=it.get('usesRandom'))
        lp = it.get('loop')
        if lp:
            err, d, de, rms = fit_loop(audio.mean(axis=1), lp['startSample'], lp['endSample'])
            s, e = lp['startSample'] + d, lp['endSample'] + de
            r['loop'] = {'startSample': s, 'endSample': e, 'start': s / RATE, 'end': e / RATE,
                         'shift': d, 'endShift': de, 'seamError': err, 'seamRms': rms}
        results.append(r)
        lp = r.get('loop')
        print(f"  {r['category']}/{r['name']}: {r['duration']:.2f} 秒"
              + (f", ループ {lp['start']:.3f}〜{lp['end']:.3f} 秒 (ずらし {lp['shift']}/{lp['endShift']}, 継ぎ目の差 {lp['seamError']:.1e})"
                 if lp else '')
              + (f", ピーク {peak:.3f}" if peak >= 1 else ''), flush=True)

    index = out / 'index.json'
    if args.only and index.exists():
        # 一部だけ書き出したときは、前の index.json の残りと合わせる
        done = {r['name'] for r in results}
        results += [r for r in json.loads(index.read_text())['items'] if r['name'] not in done]
        results.sort(key=lambda r: r['sdatIndex'])
    index.write_text(json.dumps({
        'source': ref['source'] + '・NCSF（https://github.com/CyberBotX/NCSF）の再生部で書き出し',
        'sampleRate': RATE,
        'note': 'tools/rom/ncsf_render.py が作る。名前・番号・長さは sound/rendered/index.json と同じ。'
                'loop.start/end は秒（startSample/endSample はサンプル）。loop の範囲を繰り返せば継ぎ目なく鳴る。'
                'loop.shift・endShift は sound/rendered のループの頭・終わりからのずれ（継ぎ目の差が最も小さくなるよう合わせ直した）。',
        'items': results,
    }, ensure_ascii=False, indent=1) + '\n')
    print(f'{len(results)} 個を {out} に書き出しました')


if __name__ == '__main__':
    main()
