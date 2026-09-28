"""sseq_render.py の出力: WAV・JSON・.ogg・index.json・試聴用の index.html と、音の確かめ。

確かめる内容（JSON の check に入る）:
    peak / clipped   最大値（1.0 = 16 ビットの上限）と、上限を超えて切ったサンプルの数
    rms              全体の音の大きさ（dBFS）。無音なら -inf
    centroid         スペクトルの重心（Hz）。極端に低い・高いものは変換の誤りを疑う
    seamRms          ループの継ぎ目: loopStart からの 0.05 秒と loopEnd からの 0.05 秒の差の RMS を、
                     元の RMS で割ったもの。0 なら完全に同じ（継ぎ目なく繋がる）。
                     実機でもループごとにティックの位置が最大 1 フレームずれるので、0 にはならないことがある
"""
import json
import shutil
import subprocess
import wave
from pathlib import Path

import numpy as np
import sseq_audition
from nds_sound_tables import OUTPUT_RATE_INT

FFMPEG = shutil.which('ffmpeg') or '/opt/homebrew/bin/ffmpeg'


def have_ffmpeg() -> bool:
    return Path(FFMPEG).exists()


def _rms_db(x: np.ndarray) -> float:
    if x.size == 0:
        return float('-inf')
    r = float(np.sqrt(np.mean(np.square(x, dtype=np.float64))))
    return 20 * np.log10(r) if r > 0 else float('-inf')


def _centroid(x: np.ndarray) -> float:
    mono = x.mean(axis=1) if x.ndim == 2 else x
    if mono.size < 1024:
        return 0.0
    seg = mono[:OUTPUT_RATE_INT * 60]
    spec = np.abs(np.fft.rfft(seg * np.hanning(seg.size)))
    freqs = np.fft.rfftfreq(seg.size, 1 / OUTPUT_RATE_INT)
    s = spec.sum()
    return float((spec * freqs).sum() / s) if s > 0 else 0.0


def write_wav(path: Path, pcm: np.ndarray):
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(OUTPUT_RATE_INT)
        w.writeframes(pcm.astype('<i2').tobytes())


def write_ogg(wav: Path, ogg: Path) -> bool:
    r = subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', str(wav), '-c:a', 'libopus',
                        '-b:a', '160k', '-ar', '48000', str(ogg)], capture_output=True)
    return r.returncode == 0


def write_one(out: Path, category: str, info, audio: np.ndarray, loop, meta, ogg: bool) -> dict:
    """1 曲分を書き出して index.json の項目を返す"""
    scaled = audio / 32768.0
    seam = None
    if loop:
        ls, le = loop['startSample'], loop['endSample']
        m = min(len(scaled) - le, le - ls, OUTPUT_RATE_INT // 20)
        if m > 0:
            a, b = scaled[ls:ls + m], scaled[le:le + m]
            ref = float(np.sqrt(np.mean(a ** 2))) or 1e-12
            seam = float(np.sqrt(np.mean((a - b) ** 2))) / ref
        scaled = scaled[:max(loop.get('fileEnd', le), le)]   # 前奏 + ループ 2 回で切る
    else:
        # 後ろの完全な無音（休符だけの部分）は切る。シーケンスとしての長さは sequenceDuration に残す
        nz = np.flatnonzero(np.abs(scaled).max(axis=1) >= 0.5 / 32768) if scaled.size else []
        seq_len = len(scaled)
        scaled = scaled[:int(nz[-1]) + 1] if len(nz) else scaled[:0]
        meta = {**meta, 'sequenceDuration': seq_len / OUTPUT_RATE_INT}
    peak = float(np.abs(scaled).max()) if scaled.size else 0.0
    clipped = int(np.count_nonzero(np.abs(scaled) > 32767 / 32768))
    pcm = np.clip(np.round(scaled * 32768), -32768, 32767).astype(np.int16)
    base = out / category / info.name
    write_wav(base.with_suffix('.wav'), pcm)
    has_ogg = ogg and write_ogg(base.with_suffix('.wav'), base.with_suffix('.ogg'))
    rate = OUTPUT_RATE_INT
    entry = {
        'name': info.name, 'category': category, 'sdatIndex': info.index, 'fileId': info.file_id,
        'bank': info.bank, 'volume': info.volume, 'channelPriority': info.channel_prio,
        'playerPriority': info.player_prio, 'player': info.player,
        'wav': f'{category}/{info.name}.wav', 'ogg': f'{category}/{info.name}.ogg' if has_ogg else None,
        'sampleRate': rate, 'samples': len(pcm), 'duration': len(pcm) / rate,
        'loop': None, 'peak': peak,
        'check': {'peak': peak, 'clipped': clipped, 'rmsDb': _rms_db(scaled),
                  'centroidHz': _centroid(scaled)},
        **meta,
    }
    if loop:
        entry['loop'] = {'startSample': loop['startSample'], 'endSample': loop['endSample'],
                         'start': loop['startSample'] / rate, 'end': loop['endSample'] / rate,
                         'startTick': loop['startTick'], 'endTick': loop['endTick'],
                         'lengthTicks': loop.get('lengthTicks'), 'endShift': loop.get('endShift'),
                         'seamError': loop.get('seamError'),
                         'seamRms': seam if seam is not None else float('nan')}
        entry['loopStart'] = entry['loop']['start']
        entry['loopEnd'] = entry['loop']['end']
    base.with_suffix('.json').write_text(json.dumps(entry, ensure_ascii=False, indent=1,
                                                    default=_json_default))
    return entry


def _json_default(o):
    if isinstance(o, (np.floating, np.integer)):
        return o.item()
    raise TypeError(type(o))


def _clean(o):
    """JSON に書けない inf / nan を null にする"""
    if isinstance(o, float) and not np.isfinite(o):
        return None
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_clean(v) for v in o]
    return o


#: 取り出し先（assets/extracted/<ここ>/sound/rendered）→ ゲームの名前
_TITLES = {'aa2': '逆転裁判2 A2GJ', 'aa3': '逆転裁判3 YG3J'}


def _source(out: Path) -> str:
    return f"sound_data.sdat（{_TITLES.get(out.parent.parent.name, '逆転裁判 蘇る逆転 AGYJ')}）"


def write_index(out: Path, results: list[dict], sdat, merge: bool):
    path = out / 'index.json'
    items = {}
    if merge and path.exists():
        for e in json.loads(path.read_text()).get('items', []):
            items[e['name']] = e
    for r in results:
        items[r['name']] = r
    order = sorted(items.values(), key=lambda e: e['sdatIndex'])
    uses = _script_uses(out)
    for e in order:
        e['scriptId'] = e['sdatIndex']
        e['scriptUses'] = uses.get(e['sdatIndex'], {})
    doc = {
        'source': _source(out),
        'sampleRate': OUTPUT_RATE_INT,
        'note': 'loop.start/end は秒。loop の範囲（2 回目のループ）を繰り返せば継ぎ目なく鳴る。'
                'sdatIndex は SDAT の INFO のシーケンス番号。名前の BGMnnn/SEnnn は SYMB による。'
                '台本の [bgm N] / [se N] の N は sdatIndex そのもの（scriptId。bgm 380〜386 = BGM150〜156、'
                'se 406〜450 = SE0B6〜SE0E2 など、台本に出てくる番号がすべて SDAT の空でない項目に当たることで確かめた。'
                'bgm 255 は止める）。scriptUses は台本での使用回数。',
        'items': _clean(order),
    }
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1, default=_json_default))
    (out / 'index.html').write_text(sseq_audition.page(order))


def _script_uses(out: Path) -> dict[int, dict[str, int]]:
    """台本（assets/extracted/script/*.txt）での [bgm N] / [se N] の使用回数"""
    import re
    d = out.parent.parent / 'script'
    res: dict[int, dict[str, int]] = {}
    if not d.is_dir():
        return res
    for f in d.glob('*.txt'):
        for kind, n in re.findall(r'\[(bgm|se) (\d+)', f.read_text(errors='replace')):
            u = res.setdefault(int(n), {})
            u[kind] = u.get(kind, 0) + 1
    return res
