# /// script
# requires-python = ">=3.11"
# dependencies = ["capstone>=5", "numpy"]
# ///
"""人物の動き（台本の命令 30 の「動きの番号」）と人物の番号の表を ROM から作る。

    uv run tools/rom/tbl_chars.py <rom.nds> [--root assets/extracted] [--no-png]
    （--root の既定はゲームごとの置き場所。2 = assets/extracted/aa2、3 = assets/extracted/aa3。番地は game_assets.py）

書き出すもの:
    tables/char_anims.json   動きの番号 → アニメーションのファイル・区間・コマ送り・終わり方・原点
    tables/chars.json        人物の番号 → 名前（分かるものだけ）・既定の位置・使う動き
    data/tail/chars/by_anim/NNN/fXX.png   動きの番号ごとのコマ（--no-png で省く）

ARM9 で分かったこと（番地は関数・表の場所）:
  - 人物のパック = data.bin 0x2202220（281 組の (画像, 動き)）。起動時に目次 281 × 16 バイト
    (画像の位置, 大きさ, 動きの位置, 大きさ) を 0x02278e74 に読む（0x020234e8。0x020209fc は data.bin を読む関数）
  - 動きの番号の表 0x020a8f80: 704 × (u16 ファイル NNN, u16 動きのデータの中のバイト位置)。
    命令 30 → 0x02022530 → 0x0202233c → 0x02021bac が、この表で NNN と区間を決める（0x02022b68 も同じ）
  - 区間（動きのデータの中）: u16 0, u16 コマ送りの数, u32 画像の中の位置（今は全部 0）, 続いて 8 バイト × n:
    u16 コマの位置（区間の先頭から）, u8 長さ（1/60 秒）, u8 印, u16 効果音, u16 演出
    印 1 = 部品の番号の読み方の違い（0x02020fdc）、印 2 = 効果音を鳴らす（0x020258f8）、印 4 = 演出（1 = 画面の揺れ 30 フレーム、2 = 白いフラッシュ。0x02022594）
    長さが 0xFF / 0xFE / 0xFD の項目は終わりの印（0x02021a50）: FF = 最初へ戻る（ループ）、
    FE = 直前のコマのまま止まる、FD = 人物を消す
  - 人物ごとの表 0x020a8c20: 4 バイト × 人物（u16 = 部品（OAM）の数の上限。表示には関係しない）
"""
import json
import os
import struct
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ex_chars  # noqa: E402
import gfx  # noqa: E402
from arm9 import Arm9  # noqa: E402
from game_assets import Assets, assets_of  # noqa: E402
from nds import list_files  # noqa: E402
from nitro import decompress  # noqa: E402

SCREEN_X, SCREEN_Y = 128, 96   # 0x02022530: 人物の基準点は上画面の (128, 96)
END = {0xFF: 'loop', 0xFE: 'hold', 0xFD: 'delete'}

# 名前（蘇る逆転の確かなものだけ。人物の番号と名前の番号（14 name）はほぼ同じ）
NAMES = {
    2: '成歩堂 龍一', 4: '綾里 真宵', 7: '綾里 千尋', 8: '裁判長', 9: '御剣 怜侍', 10: '亜内 武文',
    12: '星影 宇宙ノ介', 20: '糸鋸 圭介', 25: '矢張 政志', 26: '山野 星雄', 44: '宝月 茜',
    45: '宝月 巴', 49: '巌徒 海慈', 50: '市ノ谷 響華',
}


def data_bin(rom: bytes) -> bytes:
    f = next(f for f in list_files(rom) if f.path == 'data.bin')
    return rom[f.start:f.end]


def pack_parts(d: bytes, pack: int = 0x2202220) -> list[bytes]:
    n = struct.unpack_from('<I', d, pack)[0]
    ents = [struct.unpack_from('<II', d, pack + 4 + 8 * k) for k in range(n)]
    return [d[pack + p:pack + p + s] for p, s in ents]


def parse_block(anim: bytes, off: int):
    """区間を読み、(画像の中の位置, [(コマの絶対位置, 長さ, 印, 効果音, 演出)], 終わり方) を返す"""
    _z, n, gofs = struct.unpack_from('<HHI', anim, off)
    seq, end = [], None
    for i in range(max(n, 1) + 64):
        q = off + 8 + 8 * i
        if q + 8 > len(anim):
            break
        fo, dur, flag, se, fx = struct.unpack_from('<HBBHH', anim, q)
        if dur in END:
            end = END[dur]
            # 終わりの印の項目の効果音・演出も、ここに来たときに実行される
            if flag & 6:
                seq.append((None, 0, flag, se, fx))
            break
        seq.append((off + fo, dur, flag, se, fx))
    return gofs, seq, end


def script_usage(rom: bytes, argc: dict):
    """台本の命令 30 から (動き → 人物の出現回数, (項目, 人物, 話す, 黙る) の一覧, 人物 → 話し手の名前の番号の回数) を集める。
    話し手は、人物が出ている間の文（0x80 以上の語の並び）ごとに、そのときの名前（14 name）を数える"""
    f = next(f for f in list_files(rom) if f.path == 'mes_all.bin')
    mes = rom[f.start:f.end]
    anim_char: dict[int, Counter] = defaultdict(Counter)
    speakers: dict[int, Counter] = defaultdict(Counter)
    uses = []
    for e in range(struct.unpack_from('<I', mes, 0)[0]):
        off, _ = struct.unpack_from('<II', mes, 4 + 8 * e)
        b, _ = decompress(mes, off)
        w = struct.unpack(f'<{len(b) // 2}H', b[:len(b) // 2 * 2])
        first = (w[2] | w[3] << 16) // 2        # 最初の区画の位置（区画は続けて並ぶ）
        i = first
        name, shown, in_text = 0, 0, False
        while i < len(w):
            op = w[i]
            if op >= 0x80:
                if not in_text and shown and name:
                    speakers[shown][name] += 1
                in_text = True
                i += 1
                continue
            in_text = False
            n = argc.get(op, 0)
            a = w[i + 1:i + 1 + n]
            if op == 14 and a:
                name = (a[0] >> 8) & 0x7F
            if op == 30 and len(a) == 3:
                shown = a[0] & 0x1FFF
            if op == 30 and len(a) == 3 and a[0]:
                c = a[0] & 0x1FFF
                for x in a[1:]:
                    anim_char[x][c] += 1
                uses.append((e, a[0], a[1], a[2]))
            i += 1 + n
    return anim_char, uses, speakers


def speaker_of(c: int, tags: dict[int, str], speakers: dict[int, Counter]) -> int | None:
    """名札の無い人物（大写しの顔など）の名前の番号: 出ている間の文の話し手の 3/4 以上が同じ名前ならその番号"""
    if tags.get(c):
        return None
    cnt = speakers.get(c)
    if not cnt:
        return None
    n, k = cnt.most_common(1)[0]
    return n if tags.get(n) and k * 4 >= sum(cnt.values()) * 3 else None


def render_anim(gfx_b: bytes, anim_b: bytes, gofs: int, seq, dst: Path | None):
    """区間のコマを描いて (コマの絶対位置 → 番号, 原点, 大きさ) を返す。dst があれば PNG を書く"""
    pals, cells = ex_chars.parse_gfx(gfx_b[gofs:])
    frames = {}
    for fo, *_ in seq:
        if fo is None or fo in frames or fo + 4 > len(anim_b):
            continue
        k = struct.unpack_from('<H', anim_b, fo)[0]
        frames[fo] = [struct.unpack_from('<bbBB', anim_b, fo + 4 + 4 * j) for j in range(k)
                      if fo + 8 + 4 * j <= len(anim_b)]
    imgs, origin = ex_chars.render(pals, cells, frames)
    order = {fo: n for n, fo in enumerate(sorted(imgs))}
    size = [0, 0]
    for fo, img in imgs.items():
        size = [img.shape[1], img.shape[0]]
        if dst:
            dst.mkdir(parents=True, exist_ok=True)
            gfx.write_rgba_png(dst / f'f{order[fo]:02}.png', img)
    return order, list(origin), size


def build(rom: bytes, root: Path, png: bool, A: Assets) -> tuple[dict, dict]:
    a = Arm9(rom)
    parts = pack_parts(data_bin(rom), A.char_pack)
    if A.char_pack_count_word:
        assert len(parts) // 2 == a.u32(A.char_pack_count_word), '人物のパックの数が ARM9 と合わない'
    anim_char, uses, speakers = script_usage(rom, A.game.argc)
    # 2・3: 名札の文字（tables/names.json。tbl_record.py が先に書く）。名札の無い人物を話し手に結び付けるのに使う
    npath = root / 'tables' / 'names.json'
    tags = ({x['id']: x['text']['ja'] for x in json.loads(npath.read_text())['names']}
            if A.code != 'AGYJ' and npath.exists() else {})
    SCRIPT_ANIMS = A.script_anims
    names = NAMES if A.code == 'AGYJ' else {}
    table = [(a.u16(A.anim_table + 4 * i), a.u16(A.anim_table + 4 * i + 2)) for i in range(A.anim_count)]
    # ファイル NNN → 人物（台本で使われた動きから。使われていない動きは同じファイルの人物とみなす）
    file_char: dict[int, Counter] = defaultdict(Counter)
    for i, (nnn, _o) in enumerate(table):
        if i < SCRIPT_ANIMS:
            file_char[nnn].update(anim_char.get(i, Counter()))
    out_dir = root / 'data/tail/chars/by_anim'
    anims = {}
    for i, (nnn, off) in enumerate(table):
        g, an = parts[2 * nnn], parts[2 * nnn + 1]
        gofs, seq, end = parse_block(an, off)
        dst = out_dir / f'{i:03}' if png else None
        order, origin, size = render_anim(g, an, gofs, seq, dst)
        used = anim_char.get(i)
        inferred = file_char.get(nnn)
        ent = {
            'file': f'{nnn:03}', 'block_offset': off, 'gfx_offset': gofs,
            'char': (used.most_common(1)[0][0] if used else
                     inferred.most_common(1)[0][0] if inferred and i < SCRIPT_ANIMS else None),
            'char_from': 'script' if used else ('same_file' if inferred and i < SCRIPT_ANIMS else None),
            'script_uses': sum(used.values()) if used else 0,
            'end': end, 'loop': end == 'loop',
            'origin': origin, 'size': size,
            'frames': [],
        }
        if png:
            ent['png_dir'] = f'data/tail/chars/by_anim/{i:03}'
        for fo, dur, flag, se, fx in seq:
            fr = {'frame': order.get(fo), 'dur': dur}
            if fo is None:
                fr['at_end'] = True
            if flag & 2:
                fr['se'] = se
            if flag & 1:
                fr['alt_tiles'] = True     # 部品の番号を 9 ビットで読む（0x02020fdc。今の人物では未使用）
            if flag & 4:
                fr['effect'] = {1: 'shake', 2: 'flash'}.get(fx, fx)
            ent['frames'].append(fr)
        # 区間 0 のものは取り出し済みの chars/2202220/NNN と同じコマ
        if off == 0:
            ent['same_as_extracted'] = f'data/tail/chars/2202220/{nnn:03}'
        anims[str(i)] = ent
    chars = {}
    per_char: dict[int, list[int]] = defaultdict(list)
    for i in range(1, SCRIPT_ANIMS):
        c = anims[str(i)]['char']
        if c is not None:
            per_char[c].append(i)
    entries_of: dict[int, set] = defaultdict(set)
    for e, c, _t, _i in uses:
        entries_of[c & 0x1FFF].add(e)
    for c in sorted(per_char):
        ids = per_char[c]
        sp = speaker_of(c, tags, speakers)
        chars[str(c)] = {
            'name': names.get(c),
            'name_id': c if sp is None else sp,
            **({'name_from': 'speaker'} if sp is not None else {}),
            'anims': ids,
            'files': sorted({anims[str(i)]['file'] for i in ids}),
            'script_entries': sorted(entries_of.get(c, ())),
            'pos': {'x': SCREEN_X, 'y': SCREEN_Y},
            'oam_max': a.u16(A.char_table + 4 * c) if A.char_table and c < A.char_count else None,
        }
    return anims, chars


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    rom = open(sys.argv[1], 'rb').read()
    A = assets_of(rom)
    root = Path(sys.argv[sys.argv.index('--root') + 1]) if '--root' in sys.argv else A.game.out
    anims, chars = build(rom, root, '--no-png' not in sys.argv, A)
    t = root / 'tables'
    t.mkdir(parents=True, exist_ok=True)
    meta = {
        '_about': f'動きの番号（台本 30 の話す/黙る動き）→ アニメーション。ARM9 {A.anim_table:#010x} の表と data.bin {A.char_pack:#x} のパック',
        '_screen': '人物の基準点は上画面 (128, 96)。origin は PNG の中の基準点。0x4000/0x8000 は tables/chars.json の _flags',
        '_frames': 'frame = png_dir の fNN（区間の中のコマの番号）、dur = 表示する長さ（1/60 秒）。'
                   'end: loop = 最初へ戻る / hold = 最後のコマで止まる / delete = 人物を消す',
    }
    (t / 'char_anims.json').write_text(json.dumps({**meta, 'anims': anims}, ensure_ascii=False, indent=1))
    cmeta = {
        '_about': '人物の番号（台本 30 の第 1 引数の下位 13 ビット）。名前は確かなものだけ（ほかは null）。'
                  'name_id = 14 name の名前の番号（ほぼ同じ番号）。2・3 で名札の無い人物（大写しの顔など）は、'
                  '出ている間の文の話し手の 3/4 以上が同じ名前ならその番号（name_from = speaker）',
        '_flags': {
            '0x8000': '背景の表のフラグに 0x10 があるとき x = 128 - 256（横長の背景の左側に置く）。無ければ 128',
            '0x4000': '背景の表のフラグに 0x20 があるとき x = 128 + 256（横長の背景の右側に置く）。無ければ 128',
            '0x2000': '左右反転（部品の印 1 → OAM の H フリップと x の反転。0x02022568 → 0x02021214）',
        },
        '_pos': 'x, y = 上画面の座標。y は人物 28 と一部の状態（game+0x23a == 1）で 24 上がる（0x020223b4）',
    }
    (t / 'chars.json').write_text(json.dumps({**cmeta, 'chars': chars}, ensure_ascii=False, indent=1))
    n_png = sum(1 for _ in (root / 'data/tail/chars/by_anim').glob('*/*.png')) if '--no-png' not in sys.argv else 0
    print(f'動き {len(anims)} 個、人物 {len(chars)} 人、PNG {n_png} 枚')


if __name__ == '__main__':
    main()
