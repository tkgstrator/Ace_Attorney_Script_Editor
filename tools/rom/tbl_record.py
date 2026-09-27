# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy"]
# ///
"""話し手の名札と法廷記録（証拠品・人物ファイル）の表の書き出し。

    uv run tools/rom/tbl_record.py <rom.nds> [出力先（既定: assets/extracted）]

書き出すもの:
    tables/names.json      命令 14 name の名前の番号 → 名札の画像・文字送りの音
    tables/evidence.json   法廷記録の番号 → アイコン・名前・説明文の画像、話ごとの最初の中身
    record/nametag/{ja,en}/NN.png     名札（48×16、BG のパレット 0 の色）
    record/icon/{ja,en}/NNN.png       アイコン（64×64、色番号 0 は透明）
    record/icon_ds/NNN.png            命令 118 の絵（64×64）
    record/name/{ja,en}/NNN.png       証拠品・人物の名前（128×16）
    record/desc/{ja,en}/NNN.png       説明文（128×64）

ARM9 から読み取ったこと（番地はコード。詳しくは各定数の注記）:
  名札（0x0201abb4(文脈, 名前, 右か)）:
    名前 n の絵 = data.bin 0x1a81c54（英語 0x1a87454）+ (n // 5) * 0x800 + (n % 5) * 0xc0。
    上の段 6 タイル（0xc0 バイト）と、+0x400 の下の段 6 タイル（4bpp）。256 画素幅のタイルの帯に 5 個ずつ並ぶ。
    BG の VRAM 0xa80 / 0xb40（タイル 84〜89 / 90〜95）に写し、タイルマップの
    行 16・17（英語は 14・15）の列 0（右なら列 26）から 6 マス、行 18（英語は 16）に枠の下端
    （タイル 10,11,11,11,11,12、右は 13,11,11,11,11,14）を置く。パレットは文字の枠と同じ 0x1a807b4（BG パレット 0）。
    名前 0 は名札を消す。
  文字送りの音: 0x020aabc0[名前]（0 = SE 0x2d 男, 1 = SE 0x2e 女, 2 = SE 0x44 タイプライター）。
  法廷記録の表 0x020ab27c（0x18 バイト × 209 個。添字 = 台本の番号。証拠品と人物ファイルで共通。208 は第 5 話の
  携帯電話の一時の項目（036 §121 で加える）で、+8 より後ろは表の外のデータと重なる）:
    +0 アイコン, +2 名前（日本語）, +4 名前（英語）, +6 説明文（詳細窓 0x02030a40 では両言語ともこれ）,
    +8 英語のときだけ 0x02083fe8 が使う別の番号（説明文のパックの番号ではない。未解明）, +10 詳しく調べる絵, +12 3D の番号
    名前・説明文は上画面の窓（0x02030a40）ではパック[+2 / +4 / +6]、下画面（0x020841a8 / 0x020843b4）では
    data.bin 0x2b16c04 + 番号 * 0x434（名前）/ 0x29b041c + 番号 * 0x1034（説明文）で、どちらも同じ番号で引く。
    番号 0 のままの欄は空き（blank_fields。項目 0 の絵を指すわけではない）。
  アイコン: data.bin 0x1b1dbb4（英語 0x1b68614）+ アイコン * 0x820（32 バイトのパレット + 64×64 の 4bpp）。
  名前: パック 0x1b0b10c（英語 0x1b14878）の項目、パレット 0x1b0b0ec。説明文: パック 0x1ab13d4（英語 0x1ae2ea4）、パレット 0x1ab13b4。
  話ごとの最初の法廷記録: 0x020b4554[パートの番号 game+0x69] → バイト列（人物ファイル … 0xfe 証拠品 … 0xff）。
  命令 118 の絵: data.bin 0x1bb3074 + 番号 * 0x820（0x020300f8）。
"""
import json
import struct
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import gfx  # noqa: E402
import nds  # noqa: E402
from databin import read_pack  # noqa: E402
from nitro import decompress  # noqa: E402

B = 0x02000000
LANGS = ('ja', 'en')

# 名札（0x0201abb4）
NAMETAG = {'ja': 0x1a81c54, 'en': 0x1a87454}
NAMETAG_PAL = 0x1a807b4           # 文字の枠のパレット（0x0202a1f4 で BG パレット 0 へ）
NAMETAG_COUNT = 55                # 0x5800 バイト / 0x800 * 5
BLIP_TABLE = 0x020aabc0           # 名前 → 文字送りの音の種類（0x0202ab3c）
BLIP_SE = {0: 0x2d, 1: 0x2e, 2: 0x44}

# 法廷記録（0x02030a40）
REC_TABLE, REC_SIZE, REC_COUNT = 0x020ab27c, 0x18, 209
ICON = {'ja': 0x1b1dbb4, 'en': 0x1b68614}
ICON_DS = 0x1bb3074
ICON_DS_END = 0x1bcc3a8          # unknown.tsv の領域の終わり（個数は推測）
ICON_STRIDE = 0x820
NAME_PACK = {'ja': 0x1b0b10c, 'en': 0x1b14878}
NAME_PAL = 0x1b0b0ec
DESC_PACK = {'ja': 0x1ab13d4, 'en': 0x1ae2ea4}
DESC_PAL = 0x1ab13b4
START_TABLE, START_COUNT = 0x020b4554, 35

# 画像から読んだ名札の文字（日本語・英語）。0 と 41・42・54 は空
NAMETAG_TEXT = {
    'ja': ['', '？？？', 'ナルホド', 'ケイジ', 'マヨイ', 'チヒロ', 'トケイ', 'チヒロ', 'サイバンカン', 'ミツルギ',
           'アウチ', 'インターホン', 'ホシカゲ', 'デンワ', 'カンシュウ', '？？？', 'スタッフ', 'オバチャン', 'カントク',
           'テレビ', 'イトノコ', 'コナカ', 'ウメヨ', 'ボーイ', 'ヒメガミ', 'ヤハリ', 'ヤマノ', 'ニボシ', 'キュータ',
           'ナルホド', 'ミツルギ', 'ナツミ', 'ハイネ', 'カルマ', 'オウム', 'ミサイル', 'オヤジ', 'カカリカン', 'センセイ',
           'ミツルギ', 'ヤハリ', '', '', 'カチョー', 'アカネ', 'トモエ', 'ザイモン', 'ハラバイ', 'タダシキ', 'ガント',
           'キョウカ', 'カンシュ', 'ケイカン', 'オマワリ', ''],
    'en': ['', '???', 'Phoenix', 'Police', 'Maya', 'Mia', 'Alarm clock', 'Mia', 'Judge', 'Edgeworth',
           'Payne', 'Interphone', 'Grossberg', 'Cellular', 'Public', '???', 'Penny', 'Oldbag', 'Manella', 'TV',
           'Gumshoe', 'White', 'April', 'Bellboy', 'Vasquez', 'Butz', 'Sahwit', 'Will', 'Cody', 'Phoenix',
           'Edgeworth', 'Lotta', 'Yogi', 'Karma', 'Parrot', 'Missile', 'Uncle', 'Guard', 'Teacher', 'Edgeworth',
           'Butz', '', '', 'Chief', 'Ema', 'Lana', 'Marshall', 'Meekins', 'Goodman', 'Gant',
           'Angel', 'Guard', 'Officer', 'Patrolman', ''],
}

# 第 1 話で使う項目の文字（画像から読み取ったもの。改行は説明文の行）
TEXT = {
    0: ('綾里 千尋（27）', '綾里法律事務所の所長。\nぼくの上司で、\nヤリ手の弁護士。'),
    2: ('矢張 政志（23）', 'この事件の被告人。\nぼくの同級生で、\nにくめないヤツだ。'),
    3: ('高日 美佳（22）', '事件の被害者。\nマンションで一人暮らし\nしていた、モデルさん。'),
    4: ('山野 星雄（44）', '死体の第一発見者。\n新聞勧誘員で、現場で\n矢張を目撃している。'),
    5: ('亜内 武文（52）', 'この事件の担当検事。\n押しが弱く、なんとなく\nパッとしない男。'),
    6: ('高日美佳の解剖記録', '死亡時刻は、7月31日\n午後4時以降5時まで。\n鈍器による一撃で失血死。'),
    7: ('置物', '《考える人》の形を\nかたどった置物。\nかなり重い。'),
    8: ('パスポート', '事件の前日7月30日に\nニューヨークから帰国\nしているようだ。'),
    9: ('停電記録', '事件当日の午後1時から\n6時過ぎまで、現場の\nマンションは停電だった。'),
    23: ('弁護士バッジ', 'これがないと、\n誰もぼくを弁護士と\nみとめてくれない。'),
}


def load(rom_path: str):
    rom = Path(rom_path).read_bytes()
    f = next(f for f in nds.list_files(rom) if f.path == 'data.bin')
    return nds.arm9(rom), rom[f.start:f.end]


def u16(a: bytes, addr: int) -> int:
    return struct.unpack_from('<H', a, addr - B)[0]


def pack_items(d: bytes, base: int) -> list[bytes]:
    ents, _ = read_pack(d, base)
    out = []
    for p, _s in ents:
        r = decompress(d, p)
        out.append(r[0] if isinstance(r, tuple) else r)
    return out


def nametag_image(d: bytes, lang: str, n: int) -> np.ndarray:
    q, r = divmod(n, 5)
    s = NAMETAG[lang] + q * 0x800 + r * 0xc0
    return gfx.tiled(gfx.unpack4(d[s:s + 0xc0] + d[s + 0x400:s + 0x4c0]), 48, 16)


def icon_image(d: bytes, s: int):
    pal = gfx.palette(d[s:s + 32])
    return gfx.tiled(gfx.unpack4(d[s + 32:s + ICON_STRIDE]), 64, 64), pal


def desc_image(b: bytes) -> np.ndarray:
    """説明文（64×32 の OBJ ブロック 4 個: ブロック k の上半分・下半分が 128×64 の 16 画素の行に入る。tailfmt と同じ）"""
    blocks = gfx.obj_blocks(gfx.unpack4(b), 256, 32, 64, 32)
    out = np.zeros((64, 128), np.uint8)
    for k in range(4):
        out[32 * (k % 2):32 * (k % 2) + 32, 64 * (k // 2):64 * (k // 2) + 64] = blocks[:, 64 * k:64 * k + 64]
    return out


def name_image(b: bytes) -> np.ndarray:
    return gfx.obj_blocks(gfx.unpack4(b), 128, 16, 32, 16)


def blank_fields(i: int, icon: int, nja: int, nen: int, desc: int, icon0: int) -> list[str]:
    """表の空き欄（名前・説明文の番号が 0 のまま）。番号 0 の絵は項目 0（綾里千尋の人物ファイル）の名前・説明文なので、
    0 を指してよいのは項目 0 と、アイコンも項目 0 と同じ（同じ人物の別の版。項目 10）ものだけ。
    ほかの 0 は埋められていない欄（第 5 話の 171〜191 など、命令 show_item でアイコンだけ出す項目や、
    108〜115 の表の形の説明文だけの項目）で、これらは法廷記録に入ることが無く、名前・説明文の絵は無い。
    確かめ方は record_text_verify.py（空き欄の項目が台本・話の最初の中身で法廷記録に入らないこと）"""
    if i == 0 or icon == icon0:
        return []
    return [k for k, v in (('name_ja', nja), ('name_en', nen), ('desc', desc)) if v == 0]


def start_lists(a: bytes) -> list[dict]:
    out = []
    for part in range(START_COUNT):
        p = struct.unpack_from('<I', a, START_TABLE - B + 4 * part)[0] - B
        prof, ev = [], []
        while a[p] != 0xfe:
            prof.append(a[p])
            p += 1
        p += 1
        while a[p] != 0xff:
            ev.append(a[p])
            p += 1
        out.append({'part': part, 'profiles': prof, 'evidence': ev})
    return out


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    a, d = load(sys.argv[1])
    root = Path(sys.argv[2] if len(sys.argv) > 2 else Path(__file__).resolve().parents[2] / 'assets/extracted')
    rec, tables = root / 'record', root / 'tables'
    tables.mkdir(parents=True, exist_ok=True)

    # ---- 名札 ----
    tag_pal = gfx.palette(d[NAMETAG_PAL:NAMETAG_PAL + 32])
    names = []
    for n in range(NAMETAG_COUNT):
        imgs = {}
        for lang in LANGS:
            p = rec / 'nametag' / lang / f'{n:02}.png'
            p.parent.mkdir(parents=True, exist_ok=True)
            gfx.write_png(p, nametag_image(d, lang, n), tag_pal)
            imgs[lang] = str(p.relative_to(root))
        q, r = divmod(n, 5)
        blip = a[BLIP_TABLE - B + n]
        names.append({
            'id': n,
            'text': {lang: NAMETAG_TEXT[lang][n] for lang in LANGS},
            'image': imgs,
            'data_bin': {lang: hex(NAMETAG[lang] + q * 0x800 + r * 0xc0) for lang in LANGS},
            'blip': blip, 'blip_se': BLIP_SE.get(blip),
        })
    (tables / 'names.json').write_text(json.dumps({
        '_about': '命令 14 name の名前の番号（引数 >> 8）。下位 8 ビットが 0 でなければ名札を右端（x=208）に出す（台本では未使用）。'
                  '名札は 48×16。日本語は BG の行 16〜17（y=128）、英語は行 14〜15（y=112）、x=0。その下の行に枠の下端。'
                  'blip = 文字送りの音の種類（0x020aabc0）、blip_se = その効果音の番号。text は画像から読み取ったもの',
        'palette_data_bin': hex(NAMETAG_PAL),
        'layout': {'ja': {'x': 0, 'y': 128, 'x_right': 208}, 'en': {'x': 0, 'y': 112, 'x_right': 208},
                   'size': [48, 16]},
        'names': names,
    }, ensure_ascii=False, indent=1), encoding='utf-8')

    # ---- 法廷記録 ----
    name_pal = gfx.palette(d[NAME_PAL:NAME_PAL + 32])
    desc_pal = gfx.palette(d[DESC_PAL:DESC_PAL + 32])
    name_imgs = {lang: pack_items(d, NAME_PACK[lang]) for lang in LANGS}
    desc_imgs = {lang: pack_items(d, DESC_PACK[lang]) for lang in LANGS}
    for lang in LANGS:
        for kind, items, fn, pal in (('name', name_imgs[lang], name_image, name_pal),
                                     ('desc', desc_imgs[lang], desc_image, desc_pal)):
            for i, b in enumerate(items):
                p = rec / kind / lang / f'{i:03}.png'
                p.parent.mkdir(parents=True, exist_ok=True)
                gfx.write_png(p, fn(b), pal)
    n_icons = (ICON['en'] - ICON['ja']) // ICON_STRIDE
    for lang in LANGS:
        for i in range(n_icons):
            idx, pal = icon_image(d, ICON[lang] + i * ICON_STRIDE)
            p = rec / 'icon' / lang / f'{i:03}.png'
            p.parent.mkdir(parents=True, exist_ok=True)
            gfx.write_png(p, idx, pal, transparent0=True)
    for i in range((ICON_DS_END - ICON_DS) // ICON_STRIDE):
        s = ICON_DS + i * ICON_STRIDE
        idx, pal = icon_image(d, s)
        p = rec / 'icon_ds' / f'{i:03}.png'
        p.parent.mkdir(parents=True, exist_ok=True)
        gfx.write_png(p, idx, pal, transparent0=True)

    starts = start_lists(a)
    icon0 = u16(a, REC_TABLE)
    ev_used = {x for s in starts for x in s['evidence']}
    pr_used = {x for s in starts for x in s['profiles']}
    items = []
    for i in range(REC_COUNT):
        f = struct.unpack_from('<6H', a, REC_TABLE - B + i * REC_SIZE)
        icon, nja, nen, desc, desc_en2, check, model = f[0], f[1], f[2], f[3], f[4], f[5], None
        model = u16(a, REC_TABLE + i * REC_SIZE + 12)
        blank = blank_fields(i, icon, nja, nen, desc, icon0)
        # 表の外と重なる項目 208 の英語の名前（143）など、パックに無い番号も絵が無い
        blank += [k for k, v, n in (('name_en', nen, len(name_imgs['en'])), ('desc', desc, len(desc_imgs['ja'])))
                  if v >= n and k not in blank]
        e = {
            'id': i,
            'icon': icon,
            'name_index': {'ja': nja, 'en': nen},
            'desc_index': desc,
            'desc_index_alt': desc_en2,
            'check': check,
            'model3d': model,
            'image': {
                'icon': {lang: f'record/icon/{lang}/{icon:03}.png' for lang in LANGS},
                'name': {lang: None if f'name_{lang}' in blank else
                         f'record/name/{lang}/{(nja if lang == "ja" else nen):03}.png' for lang in LANGS},
                'desc': {lang: None if 'desc' in blank else f'record/desc/{lang}/{desc:03}.png' for lang in LANGS},
            },
        }
        if blank:
            e['blank'] = blank
        if i in TEXT:
            e['text_ja'] = {'name': TEXT[i][0], 'desc': TEXT[i][1]}
        if i in pr_used:
            e['start_as'] = 'profile'
        elif i in ev_used:
            e['start_as'] = 'evidence'
        items.append(e)
    (tables / 'evidence.json').write_text(json.dumps({
        '_about': '法廷記録の番号（命令 23/24/25/19 の下位 14 ビット、または 8 ビット）→ 絵と文字。証拠品と人物ファイルは'
                  '同じ表を使い、ビット 15 は入れる一覧（0 = 証拠品 0x020ce240, 1 = 人物 0x020ce260、各 32 個）だけを決める。'
                  'image.name / image.desc が null（blank に欄の名前）= 表の欄が空き（0 のまま）で絵が無い（blank_fields）。'
                  'check = 0 でなければ「詳しく調べる」がある、model3d = 第 5 話の 3D の番号（推測）。'
                  'text_ja は第 1 話で使うものだけ画像から読み取った。desc_index_alt は英語のときの下画面の処理（0x02083fe8、0x02b62684 + 番号 * 0x2034）が使う別の番号で、説明文のパックの番号とは合わない（未解明）',
        'palette_data_bin': {'name': hex(NAME_PAL), 'desc': hex(DESC_PAL), 'icon': '各アイコンの先頭 32 バイト'},
        'detail_window': {'icon': [16, 16, 64, 64], 'note': '上画面の「ファイルした」窓: アイコン 64×64・名前 128×16・説明文 128×64（OBJ）'},
        'start': starts,
        'items': items,
    }, ensure_ascii=False, indent=1), encoding='utf-8')
    print(f'名札 {NAMETAG_COUNT} 個、法廷記録 {REC_COUNT} 個、アイコン {n_icons} × 2 → {root}')


if __name__ == '__main__':
    main()
