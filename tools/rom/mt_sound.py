"""MT Framework（3DS 版）の音声 MCA を ogg にする（ffmpeg が要る）。逆転裁判5・6 で確認。

    uv run tools/rom/mt_sound.py <入力フォルダー…> --out <出力先>

入力フォルダーの下のすべての .mca を <出力先>/<入力フォルダーの名前>/<相対パス>.ogg（Opus 48 kHz）にし、
<出力先>/index.json に長さとループの位置（秒）を書く。ループする曲は loop.start〜loop.end を繰り返せば続けて鳴る。

形式（見出し）: "MADP"、u16 版（5 は 4、6 は 5）、u8 チャンネル数（0x08）、u16 インターリーブ（0x0A）、u32 サンプル数（0x0C）、
u32 サンプリング周波数（0x10）、u32 ループの始まり・終わり（0x14・0x18、サンプル単位。終わりが 0 ならループしない）。
中身は GameCube 系の 4 ビット ADPCM（ffmpeg では adpcm_thp_le として読める）。細かい形式は crates/aa-ctr/src/mca.rs。
6 のうち版 5 でマーカーを持つもの（58 本）は ffmpeg が読めず、index.json に error を書く。
それらも含めて WAV にするには Rust 版（aa-ctr の audio）を使う。ffmpeg は ADPCM の丸め方が DSP の標準と違い、±数の差がある。
"""
import argparse
import json
import struct
import subprocess
from pathlib import Path


def header(path: Path) -> dict:
    b = path.read_bytes()[:0x1C]
    if b[:4] != b'MADP':
        raise ValueError('MCA ではない')
    channels = b[8]
    samples, rate, loop_start, loop_end = struct.unpack_from('<IIII', b, 0x0C)
    info = {'channels': channels, 'rate': rate, 'seconds': round(samples / rate, 4)}
    if loop_end:
        info['loop'] = {'start': round(loop_start / rate, 4), 'end': round(loop_end / rate, 4)}
    return info


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('src', type=Path, nargs='+')
    ap.add_argument('--out', type=Path, required=True)
    a = ap.parse_args()
    index = {}
    for src in a.src:
        for f in sorted(src.rglob('*.mca')):
            rel = Path(src.name) / f.relative_to(src).with_suffix('.ogg')
            dest = a.out / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            r = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(f), '-c:a', 'libopus', '-b:a', '128k',
                                '-ar', '48000', str(dest)], capture_output=True, text=True)
            index[str(rel)] = header(f) | ({'error': r.stderr.strip().splitlines()[-1]} if r.returncode else {})
    a.out.mkdir(parents=True, exist_ok=True)
    (a.out / 'index.json').write_text(json.dumps(index, ensure_ascii=False, indent=1) + '\n')
    print(f'{len(index)} 個 → {a.out}')


if __name__ == '__main__':
    main()
