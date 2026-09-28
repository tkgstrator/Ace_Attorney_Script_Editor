# /// script
# requires-python = ">=3.11"
# dependencies = ["capstone>=5", "pillow>=10"]
# ///
"""探偵パート（移動する・話す・調べる・つきつける）の表を ARM9 から取り出して JSON にする。

    uv run tools/rom/tbl_invest.py <rom.nds> [出力 JSON（<抽出物>/tables/investigation.json）] [--ocr]

蘇る逆転・2・3 のどれでも読める（ROM のゲームコードで番地を選ぶ。2・3 の番地は invest_addrs.py）。以下の番地は蘇る逆転。

--ocr: 場所の名前・話題の名前のテクスチャを macOS の文字認識（tools/rom/ocr.swift）で読んで name_ocr に入れる
（読み違いの直しは invest_names.py と invest_names_fixes.<ゲームコード>.json）。

■ パート = ゲーム全体の状態 0x020ceda8 の +0x69（台本の項目 = パート × 2、日本語）。パートごとの表（添字 = パート、35 個）:
  0x020b443c 探偵パートの始めに呼ぶ関数（場所の表 → 0x020ceeb0、話題の表 → 0x020ce8a8 に写す。0x0202884c = 何もしない = 法廷）
  0x020b466c 場所に着いたときの関数 / 0x020b46f8 探偵パートの毎フレームの関数（どちらも中身はコード。tbl_invest_sym.py で読む）
  0x020b45e0 つきつけの表 / 0x020b4554 パートの始めの法廷記録 / 0x020b44c8 法廷での「つきつける」の表（法廷の担当向け）
■ 区画の番号は文脈 +0x4a に入る値のまま（0x80 以上 = 話の台本の §(値 - 0x80)、未満 = 共通の台本の §値）。
■ フラグは組 0（台本の 16 flag / 53 if_flag と同じ）。話題の既読だけは組 2。
"""
import json
import os
import struct
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from arm9 import Arm9  # noqa: E402
from game import detect  # noqa: E402
from invest_addrs import AGYJ, BY_CODE, InvestAddrs, item_of_k, part_items  # noqa: E402
from tbl_invest_sym import run as _run  # noqa: E402

# パートごとの表・写す先・名前のテクスチャ・court_point・調べる場所の条件の番地は invest_addrs.py（蘇る逆転 = AGYJ）:
#   data.bin の中のテクスチャ（2228 バイト = 128×32 の 16 色、20 バイトの見出しつき）。ARM9 のコードが位置を直接持つ。
#   場所の名前 28 個（移動の画面 0x02056c30）、話題の名前 188 個（話すの画面 0x020556c0）、移動先の小さな絵（16916 バイト）
#   court_point: 62 op62 の番号 × 0x2c: 法廷で「写真のここ」を指す問題
#   examine_cond: 調べる場所の表の [2] = 0xfd のときの条件（0x020353dc の中に直接書かれている）
TEX_STEP = 0x8b4
THUMB_STEP = 0x4214
#: 今読んでいるゲームの番地（main で決める）
G: InvestAddrs = AGYJ

ROOT = Path(__file__).resolve().parents[2]
#: テクスチャの PNG の置き場所（main でゲームの取り出し先にする）
TEX_DIR = ROOT / 'assets/extracted/data/tail/tex'


def sec(v: int) -> dict | None:
    if v in (0xffff, None):
        return None
    return {'raw': v, 'script': 'story' if v >= 0x80 else 'common', 'section': v - 0x80 if v >= 0x80 else v}


def run(a9: Arm9, func: int, place: int, part: int) -> list[dict]:
    return _run(a9, func, place, part, g=G.sym)


def tex(base: int, i: int, step: int = TEX_STEP) -> dict:
    a = base + i * step
    hits = sorted(TEX_DIR.glob(f'{a:07x}*.png')) if TEX_DIR.exists() else []
    return {'data_bin': f'{a:#x}', 'png': str(hits[0].relative_to(ROOT)) if hits else None}


def copies(a9: Arm9, func: int, part: int) -> dict[int, tuple[int, int]]:
    """関数の中の memcpy（0x02007498）を 先 → (元, 大きさ) にする"""
    out = {}
    for path in run(a9, func, 0, part):
        for act in path['acts']:
            if act[0] == 'copy' and None not in act[1:4]:
                out[act[2]] = (act[1], act[3])
    return out


def parse_places(d: bytes) -> list[dict]:
    """8 バイト × 場所: [0] 背景（27 の番号。50 op50 で変わる）、[1..3] = 0xff（使う場所）、[4..7] 移動先（0xff = 無し。51 で変わる）"""
    out = []
    for i in range(len(d) // 8):
        e = d[i * 8:i * 8 + 8]
        if e[1:4] != b'\xff\xff\xff':
            continue  # すべて 0 = このパートでは使わない
        out.append({'id': i, 'bg': e[0], 'dest': [x for x in e[4:8] if x != 0xff]})
    return out


def parse_talk(d: bytes) -> list[dict]:
    """0x14 バイト × 項目: [0] 場所, [1] 人物, [2] 0xff, [3] 1 = 使う/0 = 使わない（55 talk_topic で変わる）,
    [4..7] 話題の名前の番号, [8..11] 既読のフラグ（組 2）, u16[6..9] 区画"""
    out = []
    for i in range(len(d) // 0x14):
        e = d[i * 0x14:i * 0x14 + 0x14]
        if e[0] == 0xff:
            break
        secs = struct.unpack_from('<4H', e, 12)
        topics = [{'topic': e[4 + k], 'read_flag': e[8 + k], 'section': sec(secs[k])}
                  for k in range(4) if e[4 + k] != 0xff]
        out.append({'id': i, 'place': e[0], 'person': e[1], 'active': e[3] == 1, 'topics': topics})
    return out


def parse_examine(d: bytes) -> list[dict]:
    """0x14 バイト × 項目: u16 区画, [2] 種類（0 = ふつう, 0xfd = 条件つき（先に調べる）, 0xfe = 無効, 0xff = 終わり）,
    [3] 条件（EXAMINE_COND）, 4 点の (x, y)（背景の座標。横に動く背景では 0〜511）"""
    out = []
    for i in range(len(d) // 0x14):
        s, kind, cond = struct.unpack_from('<HBB', d, i * 0x14)
        if kind == 0xff:
            break
        pts = struct.unpack_from('<8h', d, i * 0x14 + 4)
        e = {'section': sec(s), 'kind': {0xfd: 'cond', 0xfe: 'off'}.get(kind, 'normal'),
             'quad': [[pts[j], pts[j + 1]] for j in range(0, 8, 2)]}
        if kind == 0xfd:
            e['cond'] = G.examine_cond.get(cond, f'never ({cond:#x})')
        elif kind not in (0, 0xfe):
            e['b2'] = kind  # 第 5 話の表では場所の番号が入っている（判定には使わない）
        out.append(e)
    return out


def parse_present(a9: Arm9, addr: int) -> list[dict]:
    """8 バイト × 項目: [0] 場所, [1] 法廷記録の番号（0xff = どれでもない）, [2] 人物, [3] 0（0xff = 終わり）, u16 区画, u16 既定の区画"""
    out = []
    while True:
        e = a9.read(addr, 8)
        if e[3] == 0xff:
            return out
        s, dflt = struct.unpack_from('<HH', e, 4)
        out.append({'place': e[0], 'item': None if e[1] == 0xff else e[1], 'person': e[2],
                    'section': sec(s), 'default': sec(dflt)})
        addr += 8


def parse_present23(a9: Arm9, addr: int) -> list[dict]:
    """2（0xa バイト）・3（0xe バイト）× 項目: [0] 場所, [1] 場所の状態（game+0x398+場所。81 op81 で変わる。0xff = どれでも）,
    [2] 法廷記録の番号（0xff = どれでもない）, [3] 人物, [4] 0 = 証拠品・1 = 人物ファイル（0xff = 終わり）, u16 区画, u16 既定の区画
    （3 の残り 4 バイトは 0）。探し方は蘇る逆転と同じ（場所・人物・種類が合う項目を上から）"""
    out = []
    while True:
        e = a9.read(addr, G.present_row)
        if e[4] == 0xff:
            return out
        s, dflt = struct.unpack_from('<HH', e, 6)
        out.append({'place': e[0], 'state': None if e[1] == 0xff else e[1], 'item': None if e[2] == 0xff else e[2],
                    'record': 'profile' if e[4] == 1 else 'evidence', 'person': e[3], 'section': sec(s), 'default': sec(dflt)})
        addr += G.present_row


def parse_record(a9: Arm9, addr: int) -> dict:
    """人物ファイルの番号の列（0xfe で終わる）+ 証拠品の番号の列（0xff で終わる）"""
    prof, ev, cur = [], [], None
    cur = prof
    while True:
        b = a9.u8(addr)
        addr += 1
        if b == 0xfe:
            cur = ev
            continue
        if b == 0xff:
            return {'profiles': prof, 'evidence': ev}
        cur.append(b)


def parse_court_present(a9: Arm9, addr: int) -> list[dict]:
    """法廷: 8 バイト × 項目: u16 今の区画（+0x4a）, u16 法廷記録の番号, u16 区画, [6] フラグ（0xff = 条件なし。組 0 が立っていれば有効）, [7]"""
    out = []
    while True:
        a, item, s, fl, x = struct.unpack('<HHHBB', a9.read(addr, 8))
        if a == 0xffff:
            return out
        e = {'at': sec(a), 'item': item, 'section': sec(s), 'flag': None if fl == 0xff else fl, 'b7': x}
        if G.item_switch is not None:
            # 3: at の 0xf000 = 106 op106 で替えた項目（文脈 +0x88 ≠ 0）のときだけ使う項目。item 0xff = どれでも
            e['at'], e['split_item'] = sec(a & 0x0fff), bool(a & 0xf000)
        out.append(e)
        addr += 8


def conv_paths(paths: list[dict], exam_tables: dict, known: dict) -> list[dict]:
    """記号実行の道を {when: {フラグ: 値}, do: [...]} にする"""
    out = []
    for p in paths:
        when, extra = {}, []
        for c, v in p['cond']:
            if c == 'lang':
                when['lang'] = v
            elif isinstance(c, tuple):
                when[f'{c[0]}:{c[1]:#x}'] = v
            else:
                extra.append(f'{c} = {v}')
        do = []
        for a in p['acts']:
            name, args = a[0], a[1:]
            if name == 'fill' and args[1] == G.examine_ram:
                do.append({'examine': None})
            elif name == 'copy' and args[1] == G.examine_ram:
                exam_tables.setdefault(f'{args[0]:#x}', parse_examine(known['a9'].read(args[0], args[2])))
                do.append({'examine': f'{args[0]:#x}'})
            elif name in ('event', 'event_keep_bgm'):
                do.append({name: sec(args[0]), 'set_flag': f'0:{args[1]:#x}'})
            elif name == 'char':
                do.append({'char': args[0], 'talk': args[1], 'idle': args[2]})
            elif name in ('bgm', 'se', 'op_2232c', 'load_part'):
                do.append({name: args[0]})
            elif name == 'bg':
                do.append({'bg': args[1]})
            elif name == 'bg_prepare':
                continue  # 直後の bg と組（背景を読み込む準備）
            elif name == 'bgm_stop':
                do.append({'bgm_stop': True})
            elif name == 'char_raw':
                do.append({'char': args[0], 'talk': args[2], 'idle': args[2]})
            elif name == 'set_flag':
                do.append({'set_flag': f'{args[0]}:{args[1]:#x}', 'value': args[2]})
            elif name in ('jump', 'box'):  # 3: event を中に書いたもの
                do.append({name: sec(args[0]) if name == 'jump' else args[0]})
            elif name == 'load_item':  # 3: 台本の項目を替える（k → 項目）
                do.append({'load_item': args[0], 'item': item_of_k(known['a9'], G, args[0])})
            elif name == 'store':  # 2・3: 表や状態へ直接書く（talk[項目][3] = 話題を使う/使わない など）
                do.append({'store': args[0], 'value': args[1]})
            elif name == 'place_state':
                do.append({'place_state': {'place': args[0], 'value': args[1]}})
            elif name in ('reload_script', 'gauge_full', 'bgm_pause', 'arrive_again'):
                do.append({name: True})
            else:
                do.append({'call': name, 'args': list(args)})
        if extra:
            when['_other'] = extra
        out.append({'when': when, 'do': do})
    return out


def part_json(a9: Arm9, part: int, bgmap: dict) -> dict:
    g = G
    init = a9.u32(g.t_init + part * 4)
    items = part_items(a9, g, part)
    j = {'part': part, 'item': items[0], 'kind': 'court' if init == g.nop else 'investigation'}
    if g is not AGYJ:
        j['items'] = items  # このパートで読み込む台本の項目（3 は 106 op106 や load_item で替わる）
    j['initial_record'] = parse_record(a9, a9.u32(g.t_record + part * 4))
    cp = a9.u32(g.t_court_present + part * 4)
    j['court_present'] = {'table': f'{cp:#x}', 'entries': parse_court_present(a9, cp)}
    if init == g.nop:
        return j
    cps = copies(a9, init, part)
    src, n = cps[g.places_ram]
    places = parse_places(a9.read(src, n))
    tsrc, tn = cps[g.talk_ram]
    j['init'] = {'func': f'{init:#x}', 'places_src': f'{src:#x}', 'talk_src': f'{tsrc:#x}'}
    if g.extra_ram in cps:
        # 2・3: 89 op89 k が使う区画の表（k 番目の u16）。サイコ・ロックの場面で使う（推測）
        esrc, en = cps[g.extra_ram]
        j['init']['op89_src'] = f'{esrc:#x}'
        j['init']['op89_sections'] = [sec(v) for v in struct.unpack(f'<{en // 2}H', a9.read(esrc, en))]
    exam: dict = {}
    known = {'a9': a9}
    if g is not AGYJ:
        # 写す以外に始めの関数がすること（フラグ・体力のゲージ）
        rest = [x for x in conv_paths(run(a9, init, 0, part), exam, known)]
        j['init']['do'] = [a for x in rest for a in x['do'] if 'call' not in a or a['call'] != 'copy']
    arrive, frame = a9.u32(g.t_arrive + part * 4), a9.u32(g.t_frame + part * 4)
    j['hooks'] = {'arrive': f'{arrive:#x}', 'frame': f'{frame:#x}'}
    for p in places:
        p['name'] = tex(g.place_tex['ja'], p['id']) if p['id'] < g.n_place_tex else None
        p['bg_file'] = bgmap.get(p['bg'])
        p['on_enter'] = conv_paths(run(a9, arrive, p['id'], part), exam, known) if arrive != g.nop else []
        fr = conv_paths(run(a9, frame, p['id'], part), exam, known) if frame != g.nop else []
        p['every_frame'] = [x for x in fr if x['do']]
        # 第 5 話: 着いたときに読み込む台本のパートが変わる（load_part）。この場所の区画はその項目のもの
        # 3: 着いたときに load_item で項目を替える
        lp = sorted({a['load_part'] for x in p['on_enter'] for a in x['do'] if 'load_part' in a})
        li = sorted({a['item'] for x in p['on_enter'] for a in x['do'] if a.get('item')})
        p['script_items'] = [f'{v * 2:03d}' for v in lp] or li or [items[0]]
    j['places'] = places
    j['talk'] = parse_talk(a9.read(tsrc, tn))
    pa = a9.u32(g.t_present + part * 4)
    j['present'] = {'table': f'{pa:#x}', 'entries': parse_present(a9, pa) if g.present_row == 8 else parse_present23(a9, pa)}
    j['examine_tables'] = exam
    return j


def court_point(a9: Arm9, n: int) -> list[dict]:
    """62 op62 k → 0x020aafd0 + k*0x2c: 4 点 × 2（当たり A, B）, u16 区画 A, B, 外れ"""
    out = []
    for k in range(n):
        d = a9.read(G.court_point + k * 0x2c, 0x2c)
        qa, qb = struct.unpack_from('<8h', d, 0), struct.unpack_from('<8h', d, 16)
        sa, sb, sm = struct.unpack_from('<3H', d, 32)
        out.append({'id': k, 'quad_a': [list(qa[i:i + 2]) for i in range(0, 8, 2)], 'section_a': sec(sa),
                    'quad_b': [list(qb[i:i + 2]) for i in range(0, 8, 2)], 'section_b': sec(sb), 'miss': sec(sm)})
    return out


def read_bgmap(p: Path) -> dict:
    """背景の番号 → 絵のファイル（script/bg_map.tsv。無ければ空 = bg_file は None）。
    ファイルは同じ取り出し先（蘇る逆転は assets/extracted、2・3 は assets/extracted/aa2 など）の data/tail/bg/ の中"""
    if not p.exists():
        return {}
    base = p.parent.parent.relative_to(ROOT).as_posix()
    out = {}
    for line in p.read_text().splitlines()[1:]:
        c = line.split('\t')
        out[int(c[0])] = f'{base}/data/tail/bg/' + c[5] if len(c) > 5 and c[5] else None
    return out


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        sys.exit(__doc__)
    global G, TEX_DIR
    rom = open(args[0], 'rb').read()
    game = detect(rom)
    G = g = BY_CODE[game.code]
    TEX_DIR = game.out / 'data/tail/tex'
    a9 = Arm9(rom)
    out = Path(args[1]) if len(args) > 1 else game.tables / 'investigation.json'
    bgmap = read_bgmap(game.script / 'bg_map.tsv')
    names: dict = {'places': [], 'topics': [], 'thumbs': []}
    if g.place_tex:
        names = {'places': [{'id': i, 'ja': tex(g.place_tex['ja'], i), 'en': tex(g.place_tex['en'], i)}
                            for i in range(g.n_place_tex)],
                 'topics': [{'id': i, 'ja': tex(g.topic_tex['ja'], i), 'en': tex(g.topic_tex['en'], i)}
                            for i in range(g.n_topic_tex)],
                 # 2・3 は移動先の小さな絵の位置が未確認（空にする）
                 'thumbs': [{'id': i, 'ja': tex(g.thumb_tex['ja'], i, THUMB_STEP), 'en': tex(g.thumb_tex['en'], i, THUMB_STEP)}
                            for i in range(g.n_thumb)] if g.thumb_tex else []}
    if '--ocr' in sys.argv:
        from invest_names import read_names
        read_names(names, g.code)
    parts = [part_json(a9, p, bgmap) for p in range(g.parts)]
    for p in parts:
        for pl in p.get('places', []):
            if pl['id'] < len(names['places']):
                pl['name']['ocr'] = names['places'][pl['id']].get('name_ocr')
        for t in p.get('talk', []):
            for x in t['topics']:
                x['name_ocr'] = names['topics'][x['topic']].get('name_ocr') if x['topic'] < len(names['topics']) else None
    from tbl_invest_rules import RULES, rules_for  # 仕組みの説明（コードの番地つき）
    doc = {'about': __doc__.strip().splitlines()[0], 'rules': RULES if g is AGYJ else rules_for(g), 'names': names,
           'court_point': court_point(a9, g.n_court_point), 'parts': parts}
    if g is not AGYJ:
        doc = {'game': g.code, **doc}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    inv = [p for p in parts if p['kind'] == 'investigation']
    print(f'{out}: 探偵パート {len(inv)} 個、場所 {sum(len(p["places"]) for p in inv)}、'
          f'話題の項目 {sum(len(p["talk"]) for p in inv)}、調べる表 {sum(len(p["examine_tables"]) for p in inv)}')


if __name__ == '__main__':
    main()
