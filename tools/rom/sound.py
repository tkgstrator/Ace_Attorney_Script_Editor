"""sound_data.sdat（Nintendo の標準の音声アーカイブ SDAT）の書き出し。

1. Python だけで SDAT を中のファイル（SSEQ/SSAR/SBNK/SWAR/STRM）に分割し、
   SYMB（名前の表）と INFO から付けた名前で raw/ に書き出す
2. sdatxtract（https://github.com/oreo639/sdatxtract）の実行ファイルが渡されたら、
   それで MIDI（SSEQ から）と WAV（SWAR の中の SWAV、STRM から）に変換したものを converted/ に書き出す
"""
import shutil
import struct
import subprocess
from pathlib import Path

# INFO/SYMB の表の番号 → (種類, 拡張子)
KINDS = {0: 'sequence', 1: 'seqarc', 2: 'bank', 3: 'wavearc', 7: 'stream'}
EXT = {b'SSEQ': 'sseq', b'SSAR': 'ssar', b'SBNK': 'sbnk', b'SWAR': 'swar', b'STRM': 'strm'}


def _names(s: bytes, symb: int, kind: int) -> list:
    """SYMB の表から名前の一覧を読む（名前の無いものは None）"""
    if not symb:
        return []
    base = symb + struct.unpack_from('<I', s, symb + 8 + 4 * kind)[0]
    n = struct.unpack_from('<I', s, base)[0]
    step = 8 if kind == 1 else 4          # SEQARC は (名前, 下位の表) の組
    out = []
    for i in range(n):
        off = struct.unpack_from('<I', s, base + 4 + step * i)[0]
        if not off:
            out.append(None)
            continue
        e = s.index(b'\0', symb + off)
        out.append(s[symb + off:e].decode('ascii', 'replace'))
    return out


def split(s: bytes) -> list[tuple[str, bytes]]:
    """SDAT を (ファイル名, 中身) の一覧に分ける"""
    if s[:4] != b'SDAT':
        raise ValueError('SDAT ではありません')
    symb, _symb_size, info, _info_size, fat, _fat_size = struct.unpack_from('<6I', s, 0x10)
    count = struct.unpack_from('<I', s, fat + 8)[0]
    fat_ents = [struct.unpack_from('<II', s, fat + 12 + 16 * i) for i in range(count)]
    named: dict[int, str] = {}
    for kind, label in KINDS.items():
        base = info + struct.unpack_from('<I', s, info + 8 + 4 * kind)[0]
        n = struct.unpack_from('<I', s, base)[0]
        names = _names(s, symb, kind)
        for i in range(n):
            off = struct.unpack_from('<I', s, base + 4 + 4 * i)[0]
            if not off:
                continue
            file_id = struct.unpack_from('<H', s, info + off)[0]
            name = names[i] if i < len(names) and names[i] else f'{label}_{i:03}'
            named.setdefault(file_id, f'{label}/{name}')
    out = []
    for fid, (off, size) in enumerate(fat_ents):
        body = s[off:off + size]
        ext = EXT.get(body[:4], 'bin')
        out.append((f'{named.get(fid, f"other/file_{fid:04}")}.{ext}', body))
    return out


def export(sdat: bytes, out: Path, sdatxtract: str | None) -> None:
    raw = out / 'raw'
    counts: dict[str, int] = {}
    for name, body in split(sdat):
        dst = raw / name
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_bytes(body)
        kind = name.split('/')[0]
        counts[kind] = counts.get(kind, 0) + 1
    print(f'  raw/: {counts}')
    if not sdatxtract:
        print('  sdatxtract が指定されていないので、変換（MIDI/WAV）は行いません')
        return
    # sdatxtract は「入力ファイルの名前（拡張子なし）」のフォルダーを作業フォルダーに作る
    conv = out / 'converted'
    if conv.exists():
        shutil.rmtree(conv)
    tmp = out / 'converted.sdat'
    tmp.write_bytes(sdat)
    try:
        r = subprocess.run([sdatxtract, '-c', '-x', tmp.name], cwd=out, capture_output=True, text=True)
    finally:
        tmp.unlink()
    print('  ' + ' '.join(r.stdout.split()[-12:]))
    if r.returncode != 0:
        print(f'  sdatxtract が失敗しました: {r.stderr.strip()[:200]}')
