# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy"]
# ///
"""命令 47 anim（特別な動き・画像）の表の書き出し。

    uv run tools/rom/tbl_anims.py <rom.nds> [出力先（既定: ゲームの置き場所。2 = assets/extracted/aa2 など）]

2・3 の表の番地は game_assets.py（label は蘇る逆転のものなので 2・3 では空）。

書き出すもの:
    tables/anims47.json          番号 → データ・位置・コマ送り・表示時間・効果音
    anims47/NNN/fNN.png, anim.tsv, anim.gif   日本語の絵（英語で差し替えがあるものは anims47/NNN_en/）

ARM9 から読み取ったこと:
  命令 47 (n, 1) = 0x020221b0(n, 0) → 0x0202203c: 表 0x020a9a80 + n * 0x18 の動きの物体を 1 個作る。
  命令 47 (n, 0) = 0x02023280(n) で番号 n の物体（0x020d3920 から 0x54 バイトずつ 32 個）を探し、0x02021444 で消す。
  どちらも 0 を返す（台本は止まらない。待つのは台本の wait）。
  表の 1 項目（0x18 バイト）:
    +0 u32  0x020a8f80 の添字 → (u16 キャラクターのパックの組の番号 = data/tail/chars/2202220/NNN, u16 動きのデータの中の位置)
    +4 u32  OBJ の VRAM の位置（推測）
    +8 s16 x, +0xa s16 y   画面上の原点（128, 96 = 上画面の中央）
    +0xc u8, +0xd u8, +0xe u16   OBJ のパレット・部品の数・優先度など（推測）
    +0x10 u32 フラグ（0x8000 = 下画面に出す: 0x02021444 が OAM の写しを 0x020cfef4 と 0x020d02f4 で切り替える）
    +0x14 u16 英語のとき使う別の項目（0x020a8cf8 + 番号 * 0x18。0xffff = 同じもの）
  法廷の視点が動いている間（0x020ce300+0x22 のビット 4）は、n >= 13 の多くの物体の x を -256 する（0x020221f8）。
  動きのデータ（位置 b から）: u16 0, u16 m, 予備 4 バイト, m × (u16 コマの位置（b から）, u8 長さ, u8 フラグ, u16 効果音, u16 補助)
    コマを「長さ」フレーム出して次へ。次の長さが 0xfd なら物体を消す、0xfe なら今のコマで止まる、
    0xff なら最初に戻る（0x02021a50）。フラグのビット 1 = そのコマに入ったとき効果音を鳴らす（0x020258f8）、
    ビット 2 = 補助の番号で 0x02022594 を呼ぶ。
"""
import json
import struct
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import ex_chars  # noqa: E402
import gfx  # noqa: E402
import nds  # noqa: E402
from databin import read_pack  # noqa: E402
from ex_tail import _unpack  # noqa: E402
from game_assets import Assets, assets_of  # noqa: E402

B = 0x02000000
TABLE, TABLE_EN, PAIRS, COUNT = 0x020a9a80, 0x020a8cf8, 0x020a8f80, 184
CHAR_PACK = 0x2202220
END = {0xfd: 'delete', 0xfe: 'stop', 0xff: 'loop'}

# 絵を見て付けた名前（推測を含む）
LABEL = {
    1: '「待った!」の吹き出し（60 フレームで自分で消える）', 2: '「異議あり!」の吹き出し（60 フレームで消える）',
    3: '「異議あり!」の吹き出し（2 と同じ）', 4: '「くらえ!」の吹き出し（60 フレームで消える）',
    10: '「待った!」（1 と同じ絵）', 11: '「異議あり!」（2 と同じ絵）', 12: '「待った!」（消えない版）',
    5: '影絵（トノサマン）', 6: '影絵（悪役）', 7: '影絵の茂み', 8: '影絵の茂み', 9: '影絵の茂み',
    20: '「証言開始」の文字（左右から流れて止まる）', 21: '「尋問開始」の文字（左右から流れて止まる）',
    22: '「証言」の文字の断片（左）', 23: '「開始」の文字の断片（右）', 24: '「尋問」の文字の断片（左）', 25: '「開始」の文字の断片（右）',
    60: '第 1 話の冒頭の赤い形（推測）', 61: '第 1 話の冒頭の赤い点滅（推測）',
    68: '下画面の案内の帯（「ムジュンのあるポイントを示そう」など）', 81: '「Match」（指紋の照合）',
    87: '照合の数字', 104: '「照合中…」', 105: '「照合終了」', 107: '手袋の手',
    149: '木槌を打つ', 150: '木槌（打ったあと）',
    151: '法廷の全景の人物（成歩堂）', 152: '法廷の全景の人物（千尋）', 153: '法廷の全景の人物（亜内）',
    154: '法廷の全景の人物（矢張）', 155: '法廷の全景の人物（紫の服）', 156: '法廷の全景の傍聴人',
    157: '法廷の全景の傍聴人（左右反転）', 164: '法廷の全景の傍聴人（別の位置）', 165: '法廷の全景の傍聴人（別の位置・反転）',
    170: '法廷の全景の裁判長',
}


def load(rom_path: str):
    rom = Path(rom_path).read_bytes()
    f = next(f for f in nds.list_files(rom) if f.path == 'data.bin')
    return nds.arm9(rom), rom[f.start:f.end], assets_of(rom)


def entry(a: bytes, base: int, i: int, pairs: int = PAIRS) -> dict:
    pair, vram, x, y, c, dd, e, flags, en = struct.unpack_from('<IIhhBBHIH', a, base - B + i * 0x18)
    pack, off = struct.unpack_from('<HH', a, pairs - B + 4 * pair)
    return {'pair': pair, 'pack': pack, 'offset': off, 'vram': hex(vram), 'x': x, 'y': y,
            'b0c': c, 'b0d': dd, 'h0e': e, 'flags': hex(flags), 'bottom_screen': bool(flags & 0x8000),
            'en_entry': None if en == 0xffff else en}


def sequence(anim: bytes, off: int) -> dict:
    m = struct.unpack_from('<H', anim, off + 2)[0]
    seq = [struct.unpack_from('<HBBHH', anim, off + 8 + 8 * k) for k in range(m)]
    steps, total, end = [], 0, 'stop'
    for fo, dur, fl, se, aux in seq:
        if dur in END:
            end = END[dur]
            break
        st = {'frame': fo, 'frames': dur}
        if fl & 2:
            st['se'] = se
        if fl & 4:
            st['aux'] = aux
        if fl & ~6:
            st['flags'] = fl
        steps.append(st)
        total += dur
    return {'steps': steps, 'total_frames': total, 'end': end}


def render(gfx_b: bytes, anim: bytes, off: int, seq: dict, dst: Path) -> list[str]:
    pals, cells = ex_chars.parse_gfx(gfx_b)
    frames = {}
    for st in seq['steps']:
        fo = off + st['frame']
        if fo not in frames and fo + 4 <= len(anim):
            k = struct.unpack_from('<H', anim, fo)[0]
            frames[fo] = [struct.unpack_from('<bbBB', anim, fo + 4 + 4 * j) for j in range(k)]
    imgs, origin = ex_chars.render(pals, cells, frames)
    dst.mkdir(parents=True, exist_ok=True)
    names = {}
    for n, (fo, img) in enumerate(sorted(imgs.items())):
        names[fo] = f'f{n:02}.png'
        gfx.write_rgba_png(dst / names[fo], img)
    rows = [f'{names.get(off + st["frame"], "-")}\t{st["frames"]}\t{st.get("se", "")}' for st in seq['steps']]
    (dst / 'anim.tsv').write_text(f'# 原点: 画像の {origin}（画面では表の x, y に来る）。終わり: {seq["end"]}\n'
                                  'コマ\t長さ（1/60 秒）\t効果音\n' + '\n'.join(rows) + '\n', encoding='utf-8')
    if len(names) > 1:
        args = []
        for st in seq['steps']:
            if off + st['frame'] in names:
                args += ['-delay', str(max(2, round(min(st['frames'], 120) * 100 / 60))),
                         str(dst / names[off + st['frame']])]
        subprocess.run(['magick', '-dispose', 'background', *args, '-loop', '0', str(dst / 'anim.gif')],
                       check=False, capture_output=True)
    return [list(origin)] if origin else []


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    a, d, A = load(sys.argv[1])
    root = Path(sys.argv[2]) if len(sys.argv) > 2 else A.game.out
    out = build(a, d, A, root)
    (root / 'tables').mkdir(parents=True, exist_ok=True)
    (root / 'tables' / 'anims47.json').write_text(json.dumps({
        '_about': '命令 47 anim の番号 → 動きの物体。(n, 1) で出し (n, 0) で消す。台本は止まらない（待ちは台本の wait）。'
                  'steps = コマ送り（frames は 1/60 秒、se はそのコマで鳴る効果音）、end = 最後の後の動き'
                  '（delete = 自分で消える, stop = 最後のコマで止まる, loop = 繰り返す）。total_frames = end までの長さ。'
                  'en = 英語のときに使う項目',
        'anims': out,
    }, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'{len(out)} 個 → {root}/tables/anims47.json')


def build(a: bytes, d: bytes, A: Assets, root: Path) -> list[dict]:
    ents, _ = read_pack(d, A.char_pack)
    cache: dict[int, bytes] = {}

    def part(k: int) -> bytes:
        if k not in cache:
            cache[k] = _unpack(d, *ents[k])[0]
        return cache[k]

    def one(e: dict, dst: Path) -> None:
        g, an = part(2 * e['pack']), part(2 * e['pack'] + 1)
        e.update(sequence(an, e['offset']))
        e['image_dir'] = str(dst.relative_to(root))
        e['chars_dir'] = f'data/tail/chars/{A.char_pack:07x}/{e["pack"]:03}'
        try:
            e['origin_in_image'] = render(g, an, e['offset'], e, dst)
        except (struct.error, IndexError, ValueError) as ex:
            e['error'] = str(ex)

    out = []
    label = LABEL if A.code == 'AGYJ' else {}
    for i in range(1, A.anims47_count):
        e = {'id': i, 'label': label.get(i, ''), **entry(a, A.anims47_table, i, A.anims47_pairs)}
        if A.anims47_per_lang and e['en_entry'] is not None:
            # 3: 日本語でも差し替えの表（言語の添字 0）の項目を使う
            e = {**e, **entry(a, A.anims47_en, e['en_entry'], A.anims47_pairs), 'en_entry': e['en_entry'],
                 'ja_from_alt_table': True}
        one(e, root / 'anims47' / f'{i:03}')
        if e['en_entry'] is not None:
            en_base = A.anims47_en + A.anims47_per_lang
            en = entry(a, en_base, e['en_entry'], A.anims47_pairs)
            one(en, root / 'anims47' / f'{i:03}_en')
            e['en'] = en
        out.append(e)
    return out


if __name__ == '__main__':
    main()
