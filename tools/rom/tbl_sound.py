# /// script
# requires-python = ">=3.11"
# dependencies = ["capstone>=5"]
# ///
"""台本の音の番号 → SDAT のシーケンス（SSEQ）の対応表を assets/extracted/tables/sound.json に書き出す。

    uv run tools/rom/tbl_sound.py <rom.nds> [出力 JSON] [--check assets/extracted/script/000.txt ...]

分かったこと（ARM9 の番地つき。詳しい根拠は各定数の注記）:
- 台本の番号は SDAT の INFO のシーケンスの添字そのもの（変換の表は無い）。
  命令 5 bgm → 0x020254e8 → 0x02025878 → 0x02060dec(NNS_SndArcPlayerStartSeq, 取っ手 0x020ce4c8, 番号)
  命令 6 se  → 0x020258f8 → 0x02060dec(取っ手 0x020ce4cc, 番号)。英語のときだけ一部を置き換える（EN_REMAP）
- BGM と SE は同じ番号の空間（bgm で SE 名の曲、se で BGM 名の曲を鳴らす例もある）。
  名前（SYMB）は BGMnnn（10 進）と SE0xx（16 進、番号 - 0x2a）。どの PLAYER で鳴るかは INFO の playerNo が決める。
- 書き出された .sseq のファイル名は同じ中身（fileId）の最初の名前になる（sound.py の命名に合わせる）。
"""
import json
import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from arm9 import Arm9  # noqa: E402
from nds import list_files  # noqa: E402

# 英語（0x020ceda8+4 == 1）のときの se の置き換え（0x020258f8 の比較の並び。リテラル 0x02025988〜）
EN_REMAP = {0x37: 0x195, 0x38: 0x193, 0x39: 0x192, 0x41: 0x194, 0x47: 0x191, 0x51: 0x190}
# 文字送りの音: 解釈ループ 0x020249ec の mov（0x02024a64 = 0x2d, 0x02024a6c = 0x2e, 0x02024a88 = 0x44）
BLIP_MOVS = {0: 0x02024a64, 1: 0x02024a6c, 2: 0x02024a88}
# 名前の番号 → 文字送りの音の種類（命令 14 name: 0x0202ab3c〜 で (引数 >> 8) & 0x7f を添字に読む）
NAME_KIND_TABLE, NAME_KIND_COUNT = 0x020aabc0, 64
# 英語のときの文字の速さの置き換え（0x02024bb4、速さ < 16 のとき）
EN_SPEED_TABLE = 0x020b3e68


def _mov_imm(a: Arm9, addr: int) -> int:
    """mov rX, #imm（ARM）の即値を読む"""
    w = a.u32(addr)
    if (w & 0x0FFF0000) != 0x03A00000:
        raise ValueError(f'{addr:#x} は mov #imm ではありません: {w:#010x}')
    rot, imm = (w >> 8) & 0xF, w & 0xFF
    return ((imm >> (2 * rot)) | (imm << (32 - 2 * rot))) & 0xFFFFFFFF


def _symb_names(s: bytes, symb: int, kind: int) -> list:
    base = symb + struct.unpack_from('<I', s, symb + 8 + 4 * kind)[0]
    n = struct.unpack_from('<I', s, base)[0]
    out = []
    for i in range(n):
        off = struct.unpack_from('<I', s, base + 4 + 4 * i)[0]
        out.append(s[symb + off:s.index(b'\0', symb + off)].decode('ascii') if off else None)
    return out


def sequences(sdat: bytes) -> dict[int, dict]:
    """INFO のシーケンスの一覧（添字 → 情報）。file は sound.py が書き出す名前"""
    symb, _, info, _, _, _ = struct.unpack_from('<6I', sdat, 0x10)
    names = _symb_names(sdat, symb, 0)
    base = info + struct.unpack_from('<I', sdat, info + 8)[0]
    n = struct.unpack_from('<I', sdat, base)[0]
    first_name: dict[int, str] = {}
    out: dict[int, dict] = {}
    for i in range(n):
        off = struct.unpack_from('<I', sdat, base + 4 + 4 * i)[0]
        if not off:
            continue
        fid, bank, vol, cprio, pprio, player = struct.unpack_from('<IHBBBB', sdat, info + off)
        name = names[i] or f'sequence_{i:03}'
        first_name.setdefault(fid, name)
        out[i] = {'sseq': i, 'name': name, 'file': f'{first_name[fid]}.sseq', 'file_id': fid,
                  'bank': bank, 'volume': vol, 'channel_prio': cprio, 'player_prio': pprio, 'player': player}
    return out


def players(sdat: bytes) -> list[dict]:
    symb, _, info, _, _, _ = struct.unpack_from('<6I', sdat, 0x10)
    names = _symb_names(sdat, symb, 4)
    base = info + struct.unpack_from('<I', sdat, info + 8 + 4 * 4)[0]
    out = []
    for i in range(struct.unpack_from('<I', sdat, base)[0]):
        off = struct.unpack_from('<I', sdat, base + 4 + 4 * i)[0]
        if off:
            max_seq, _pad, ch_mask, heap = struct.unpack_from('<BBHI', sdat, info + off)
            out.append({'player': i, 'name': names[i], 'max_seq': max_seq, 'heap': heap})
    return out


def build(rom: bytes) -> dict:
    a = Arm9(rom)
    f = next(f for f in list_files(rom) if f.path.endswith('sound_data.sdat'))
    seqs = sequences(rom[f.start:f.end])
    blip_ids = {k: _mov_imm(a, ad) for k, ad in BLIP_MOVS.items()}
    kinds = list(a.read(NAME_KIND_TABLE, NAME_KIND_COUNT))
    en_speed = [a.u32(EN_SPEED_TABLE + 4 * i) for i in range(16)]
    by = lambda p: {str(i): v for i, v in seqs.items() if v['name'].startswith(p)}  # noqa: E731
    return {
        'note': '台本の番号 = SDAT のシーケンスの添字（表による変換なし）。bgm/se は同じ番号空間。'
                '鍵は台本の番号（10 進の文字列）。file は assets/extracted/sound/raw/sequence/ のファイル名',
        'players': players(rom[f.start:f.end]),
        'bgm': by('BGM'),
        'se': by('SE'),
        'other': {str(i): v for i, v in seqs.items() if not v['name'].startswith(('BGM', 'SE'))},
        'se_en_remap': {str(k): {'to': v, 'name': seqs[v]['name']} for k, v in EN_REMAP.items()},
        'blip': {
            'kinds': {str(k): {'sseq': v, 'name': seqs[v]['name'], 'file': seqs[v]['file'],
                               'player': seqs[v]['player']} for k, v in blip_ids.items()},
            'kind_names': {'0': '標準（主に男性）', '1': '女性', '2': 'タイプライター（日時・場所の表示など）'},
            'name_kind': kinds,
            'rule_ja': '1 文字を出すたびに数え、カウンタ c が 0 か、速さ >= 5 なら鳴らす（それ以外は c -= 1）。'
                       '鳴らしたら種類 != 2 のとき c = 1（= 1 文字おき）、種類 2 は c をそのまま（毎文字）。'
                       '区画の始めに c = 1（最初の文字は鳴らない）。速さ 0（瞬間表示）・文字 0x17f・文脈+0x390 bit2 では鳴らない',
            'rule_en': '英語: 鳴らしたら c = 2。c が 0、または速さ >= 2 かつ c <= 1 なら鳴らす（= 2 文字おき、速さ 1 は 3 文字おき）。区画の始めに c = 2',
            'en_speed_table': en_speed,
        },
    }


def check(table: dict, paths: list[str]) -> list[str]:
    """台本の bgm/se の番号がすべて表にあるか調べる"""
    known = {**table['bgm'], **table['se'], **table['other']}
    bad = []
    for p in paths:
        text = Path(p).read_text()
        for op, n in re.findall(r'\[(bgm|se) (\d+) \d+\]', text):
            if n != '255' and n not in known:
                bad.append(f'{p}: {op} {n}')
    return sorted(set(bad))


def main() -> None:
    args = sys.argv[1:]
    checks = []
    if '--check' in args:
        i = args.index('--check')
        checks, args = args[i + 1:], args[:i]
    if not args:
        sys.exit(__doc__)
    rom = Path(args[0]).read_bytes()
    out = Path(args[1] if len(args) > 1 else 'assets/extracted/tables/sound.json')
    table = build(rom)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(table, ensure_ascii=False, indent=1))
    print(f'{out}: bgm {len(table["bgm"])}, se {len(table["se"])}')
    if checks:
        bad = check(table, checks)
        print('対応の無い番号:', bad or 'なし')


if __name__ == '__main__':
    main()
