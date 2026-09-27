# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy"]
# ///
"""SDAT の SSEQ を DS の音源と同じ計算で WAV にする（BGM・効果音）。

    uv run tools/rom/sseq_render.py                      # すべて
    uv run tools/rom/sseq_render.py --only BGM001,SE000  # 一部だけ
    uv run tools/rom/sseq_render.py --no-ogg --jobs 4

入力: assets/extracted/files/sound_data.sdat（extract_assets.py の files で書き出したもの。ROM は読まない）
出力: assets/extracted/sound/rendered/
    bgm/<名前>.wav・.json・.ogg、se/<名前>.wav・.json・.ogg、index.json、index.html（試聴用）

WAV は 32728 Hz（DS のミキサーの周波数 33513982/1024）、16 ビット ステレオ。
ループする曲は「前奏 + ループ 2 回」を書き出し、ちょうど 1 ループ分の区間 loopStart〜loopEnd
（サンプル数と秒）を JSON に書く。loopEnd に来たら loopStart に戻せば続きとして鳴る。
区間の頭は 1 回目のループの中から、継ぎ目の差が最も小さい位置を選ぶ（choose_loop を参照）。
ファイルを最後まで流せば、実機で 2 周させたのと同じ音になる。
.ogg は Opus 48 kHz（ffmpeg があれば）。ループの位置は秒で同じ JSON にある。

仕組みは sseq_player.py・sseq_track.py（シーケンサー）・sseq_channel.py（チャンネル）・nds_sound_tables.py（表）・
nds_sbnk_swar.py（音色と波形）を参照。出力と確かめは sseq_outputs.py、試聴ページは sseq_audition.py。
"""
import argparse
import math
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import sseq_outputs  # noqa: E402
from nds_sbnk_swar import parse_sbnk, parse_swar  # noqa: E402
from nds_sound_tables import OUTPUT_RATE_INT  # noqa: E402
from sdat_info import Sdat, SeqInfo  # noqa: E402
from sseq_player import Player  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SDAT = ROOT / 'assets/extracted/files/sound_data.sdat'
DEFAULT_OUT = ROOT / 'assets/extracted/sound/rendered'
MASTER = 127 / 128              # 全体の音量（SND_SetMasterVolume(127)）
CHECK_SECONDS = 1.0             # ループの継ぎ目を確かめるために loopEnd の後ろも作る長さ

_sdat: Sdat | None = None
_bank_cache: dict[int, tuple] = {}
_swar_cache: dict[int, list] = {}


def _load(sdat: Sdat, bank_id: int):
    """バンクと、それが使う 4 個の波形書庫を読む（プロセスごとに覚えておく）"""
    if bank_id in _bank_cache:
        return _bank_cache[bank_id]
    fid, arcs = sdat.banks[bank_id]
    bank = parse_sbnk(sdat.file(fid))
    waves = []
    for wa in arcs:
        if wa == 0xFFFF or wa not in sdat.wavearcs:
            waves.append([])
            continue
        if wa not in _swar_cache:
            _swar_cache[wa] = parse_swar(sdat.file(sdat.wavearcs[wa]))
        waves.append(_swar_cache[wa])
    _bank_cache[bank_id] = (bank, waves, [sdat.wavearc_name(w) for w in arcs if w != 0xFFFF])
    return _bank_cache[bank_id]


def frame_start(f: int) -> int:
    """フレーム f が始まる出力サンプルの位置（1 フレーム = 170.5 サンプル）"""
    return (f * 341) // 2


def loop_plan(p: Player, end_ticks: dict[int, int]):
    """ループの位置（ティック）を決める。まだ決められなければ None

    ジャンプで戻るトラックは、戻った 2 回のティックの差がループの長さ。すべての長さの最小公倍数を
    曲のループの長さ L とする。返すのは (end, L, kmin):
        end   前奏 + ループ 2 回が終わるティック（ファイルはここで切る）
        kmin  すべてのトラックがループに入った（止まるトラックは止まった）ティック。
              ループの始まりは kmin〜end - L のどこかから選ぶ（choose_loop）
    """
    lengths, firsts, entries = [], [], []
    for t in p.tracks:
        ev = p.loops.get(t.no)
        if not ev:
            if not t.end:
                return None                 # まだ前奏の途中のトラックがある
            continue
        if len(ev) < 2:
            return None
        ln = ev[1][0] - ev[0][0]
        if ln <= 0:
            return None
        lengths.append(ln)
        firsts.append(ev[0][0])
        entries.append(ev[0][0] - ln)
    if not lengths:
        return None
    length = 1
    for x in lengths:
        length = length * x // math.gcd(length, x)
    ends = [end_ticks[t.no] for t in p.tracks if t.no not in p.loops and t.no in end_ticks]
    kmin = max(entries + ends)
    start = max(firsts)                     # 1 回目のループの終わり
    while start < kmin + length:
        start += length
    return start + length, length, max(kmin, start - length)


def choose_loop(mono: np.ndarray, tick_sample: list[int], kmin: int, kmax: int, length: int,
                win: int = 655):
    """ループの始まりのティック k（kmin〜kmax）と、終わりのずらし方を、継ぎ目の差が最も小さいものにする

    テンポのカウンターの端数（1 ティック = 240 / テンポ フレーム）がループのたびに変わるので、
    実機でもループの 1 回ごとに、音符の出だしが 0〜1 フレーム（170.5 サンプル）ずれる。
    そのため「ループの頭」で切ると、鳴っている音の位相が合わずに継ぎ目でプツッと鳴ることがある。
    ここでは loopEnd の後ろ win サンプルが loopStart の後ろと最もよく合う (k, ずらし) を選ぶ
    （差は曲全体の RMS で割って比べるので、音の少ないところも選ばれやすい）。
    """
    g = float(np.sqrt(np.mean(mono ** 2))) or 1.0
    best = None
    for k in range(kmin, kmax + 1):
        ls, le0 = tick_sample[k], tick_sample[k + length]
        if le0 + 171 + win > len(mono):
            break
        a = mono[ls:ls + win]
        for d in (0, -1, 1, -170, -171, 170, 171):
            e = float(np.sum((a - mono[le0 + d:le0 + d + win]) ** 2))
            if best is None or e < best[0]:
                best = (e, k, ls, le0 + d, d)
    if best is None:
        return None
    e, k, ls, le, d = best
    return {'startTick': k, 'endTick': k + length, 'startSample': ls, 'endSample': le,
            'endShift': d, 'seamError': float(np.sqrt(e / win)) / g}


def render(sdat: Sdat, info: SeqInfo, max_seconds: float):
    bank, waves, arc_names = _load(sdat, info.bank)
    mask = sdat.players.get(info.player, (1, 0))[1]
    p = Player(sdat.file(info.file_id), bank, waves, info.volume, info.channel_prio, mask)
    chunks_l, chunks_r = [], []
    total = 0
    end_ticks: dict[int, int] = {}
    plan = None
    max_frames = int(max_seconds * OUTPUT_RATE_INT / 170.5)
    stop_frame = None
    while p.frame_no < max_frames:
        f = p.frame_no
        p.frame()
        for t in p.tracks:
            if t.end and t.no not in end_ticks:
                end_ticks[t.no] = p.tick_no
        n = frame_start(f + 1) - frame_start(f)
        bl = np.zeros(n)
        br = np.zeros(n)
        for ch in p.channels:
            ch.render(n, bl, br)
        chunks_l.append(bl)
        chunks_r.append(br)
        total += n
        if p.finished:
            break
        if plan is None and p.loops and f % 32 == 0:
            plan = loop_plan(p, end_ticks)
        if plan is not None and stop_frame is None and p.tick_no > plan[0]:
            stop_frame = p.frame_no + int(CHECK_SECONDS * OUTPUT_RATE_INT / 170.5)
        if stop_frame is not None and p.frame_no >= stop_frame:
            break
    left = np.concatenate(chunks_l) * MASTER if chunks_l else np.zeros(0)
    right = np.concatenate(chunks_r) * MASTER if chunks_r else np.zeros(0)
    loop = None
    if plan is not None and plan[0] < len(p.tick_frames):
        # ティックを実行したフレームの次のフレームから音が変わる
        tick_sample = [frame_start(f + 1) for f in p.tick_frames]
        end, length, kmin = plan
        loop = choose_loop(left + right, tick_sample, kmin, end - length, length)
        if loop:
            loop['fileEnd'] = tick_sample[end]
            loop['lengthTicks'] = length
            loop['tempoPhase'] = [p.tick_phase[loop['startTick']], p.tick_phase[loop['endTick']]]
    meta = {
        'finished': p.finished, 'capped': p.frame_no >= max_frames and not p.finished,
        'bankName': sdat.bank_name(info.bank), 'waveArchives': arc_names,
        'tracks': len(p.tracks), 'missingWaves': sorted(p.missing),
        'usesRandom': p.used_random,
    }
    return np.stack([left, right], axis=1), loop, meta


def _job(args):
    sdat_path, idx, out, max_bgm, max_se, ogg = args
    global _sdat
    if _sdat is None:
        _sdat = Sdat(Path(sdat_path).read_bytes())
    info = next(s for s in _sdat.seqs if s.index == idx)
    is_bgm = info.name.upper().startswith('BGM')
    audio, loop, meta = render(_sdat, info, max_bgm if is_bgm else max_se)
    return sseq_outputs.write_one(Path(out), 'bgm' if is_bgm else 'se', info, audio, loop, meta,
                                  ogg)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--sdat', default=str(DEFAULT_SDAT))
    ap.add_argument('--out', default=str(DEFAULT_OUT))
    ap.add_argument('--only', help='名前（SYMB）かシーケンスの番号をカンマ区切りで')
    ap.add_argument('--jobs', type=int, default=0, help='並列の数（0 = CPU の数）')
    ap.add_argument('--no-ogg', action='store_true', help='.ogg を作らない')
    ap.add_argument('--max-bgm', type=float, default=900, help='BGM の長さの上限（秒）')
    ap.add_argument('--max-se', type=float, default=60, help='効果音の長さの上限（秒）')
    args = ap.parse_args()
    sdat = Sdat(Path(args.sdat).read_bytes())
    seqs = sdat.seqs
    if args.only:
        want = {w.strip() for w in args.only.split(',')}
        seqs = [s for s in seqs if s.name in want or str(s.index) in want]
    out = Path(args.out)
    ogg = not args.no_ogg and sseq_outputs.have_ffmpeg()
    jobs = [(args.sdat, s.index, str(out), args.max_bgm, args.max_se, ogg) for s in seqs]
    results = []
    with ProcessPoolExecutor(max_workers=args.jobs or None) as ex:
        for r in ex.map(_job, jobs):
            results.append(r)
            lp = r.get('loop')
            print(f"  {r['category']}/{r['name']}: {r['duration']:.2f} 秒"
                  + (f", ループ {lp['start']:.3f}〜{lp['end']:.3f} 秒 (継ぎ目の差 {lp['seamRms']:.1e})" if lp else '')
                  + (f", ピーク {r['peak']:.3f}" if r['peak'] >= 1 else ''), flush=True)
    sseq_outputs.write_index(out, results, sdat, merge=bool(args.only))
    print(f'{len(results)} 個を {out} に書き出しました')


if __name__ == '__main__':
    main()
