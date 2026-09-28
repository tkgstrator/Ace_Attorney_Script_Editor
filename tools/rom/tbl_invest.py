# /// script
# requires-python = ">=3.11"
# dependencies = ["capstone>=5", "pillow>=10"]
# ///
"""探偵パート（移動する・話す・調べる・つきつける）の表を ARM9 から取り出して JSON にする。

    uv run tools/rom/tbl_invest.py <rom.nds> [出力 JSON（assets/extracted/tables/investigation.json）] [--ocr]

--ocr: 場所の名前・話題の名前のテクスチャを macOS の文字認識（tools/rom/ocr.swift）で読んで name_ocr に入れる（推測）。

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
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from arm9 import Arm9  # noqa: E402
from tbl_invest_sym import run  # noqa: E402

PARTS = 35
T_INIT, T_ARRIVE, T_FRAME = 0x020b443c, 0x020b466c, 0x020b46f8
T_PRESENT, T_RECORD, T_COURT_PRESENT = 0x020b45e0, 0x020b4554, 0x020b44c8
NOP = 0x0202884c
PLACES_RAM, TALK_RAM, EXAMINE_RAM = 0x020ceeb0, 0x020ce8a8, 0x020ceb28
# data.bin の中のテクスチャ（2228 バイト = 128×32 の 16 色、20 バイトの見出しつき）。ARM9 のコードが位置を直接持つ
TEX_STEP = 0x8b4
PLACE_TEX = {'ja': 0x026a23c8, 'en': 0x026b1778}   # 場所の名前 28 個（移動の画面 0x02056c30）
TOPIC_TEX = {'ja': 0x026c0b28, 'en': 0x02726f58}   # 話題の名前 188 個（話すの画面 0x020556c0）
THUMB_TEX = {'ja': 0x0278d388, 'en': 0x02804fcc}   # 移動先の小さな絵（16916 バイト）
THUMB_STEP = 0x4214
N_PLACE_TEX, N_TOPIC_TEX = 28, 188
COURT_POINT = 0x020aafd0  # 62 op62 の番号 × 0x2c: 法廷で「写真のここ」を指す問題
# 調べる場所の表の [2] = 0xfd のときの条件（0x020353dc の中に直接書かれている）
EXAMINE_COND = {
    0x0d: 'flag 0x49 == 1', 0x0e: 'flag 0x72 == 0', 0x0f: 'never', 0x10: 'always', 0x11: 'flag 0xa0 == 0',
    0x12: 'part in 17..18 and flag 0x43 == 0', 0x13: 'part in 17..18 and flag 0x44 == 0', 0xba: 'flag 0x44 == 1',
}

ROOT = Path(__file__).resolve().parents[2]
TEX_DIR = ROOT / 'assets/extracted/data/tail/tex'


def sec(v: int) -> dict | None:
    if v in (0xffff, None):
        return None
    return {'raw': v, 'script': 'story' if v >= 0x80 else 'common', 'section': v - 0x80 if v >= 0x80 else v}


def tex(base: int, i: int, step: int = TEX_STEP) -> dict:
    a = base + i * step
    hits = sorted(TEX_DIR.glob(f'{a:x}*.png')) if TEX_DIR.exists() else []
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
            e['cond'] = EXAMINE_COND.get(cond, f'never ({cond:#x})')
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
        out.append({'at': sec(a), 'item': item, 'section': sec(s), 'flag': None if fl == 0xff else fl, 'b7': x})
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
            if name == 'fill' and args[1] == EXAMINE_RAM:
                do.append({'examine': None})
            elif name == 'copy' and args[1] == EXAMINE_RAM:
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
            else:
                do.append({'call': name, 'args': list(args)})
        if extra:
            when['_other'] = extra
        out.append({'when': when, 'do': do})
    return out


def part_json(a9: Arm9, part: int, bgmap: dict) -> dict:
    init = a9.u32(T_INIT + part * 4)
    j = {'part': part, 'item': f'{part * 2:03d}', 'kind': 'court' if init == NOP else 'investigation'}
    j['initial_record'] = parse_record(a9, a9.u32(T_RECORD + part * 4))
    cp = a9.u32(T_COURT_PRESENT + part * 4)
    j['court_present'] = {'table': f'{cp:#x}', 'entries': parse_court_present(a9, cp)}
    if init == NOP:
        return j
    cps = copies(a9, init, part)
    src, n = cps[PLACES_RAM]
    places = parse_places(a9.read(src, n))
    tsrc, tn = cps[TALK_RAM]
    j['init'] = {'func': f'{init:#x}', 'places_src': f'{src:#x}', 'talk_src': f'{tsrc:#x}'}
    exam: dict = {}
    known = {'a9': a9}
    arrive, frame = a9.u32(T_ARRIVE + part * 4), a9.u32(T_FRAME + part * 4)
    j['hooks'] = {'arrive': f'{arrive:#x}', 'frame': f'{frame:#x}'}
    for p in places:
        p['name'] = tex(PLACE_TEX['ja'], p['id']) if p['id'] < N_PLACE_TEX else None
        p['bg_file'] = bgmap.get(p['bg'])
        p['on_enter'] = conv_paths(run(a9, arrive, p['id'], part), exam, known) if arrive != NOP else []
        fr = conv_paths(run(a9, frame, p['id'], part), exam, known) if frame != NOP else []
        p['every_frame'] = [x for x in fr if x['do']]
        # 第 5 話: 着いたときに読み込む台本のパートが変わる（load_part）。この場所の区画はその項目のもの
        lp = sorted({a['load_part'] for x in p['on_enter'] for a in x['do'] if 'load_part' in a})
        p['script_items'] = [f'{v * 2:03d}' for v in lp] or [f'{part * 2:03d}']
    j['places'] = places
    j['talk'] = parse_talk(a9.read(tsrc, tn))
    pa = a9.u32(T_PRESENT + part * 4)
    j['present'] = {'table': f'{pa:#x}', 'entries': parse_present(a9, pa)}
    j['examine_tables'] = exam
    return j


def court_point(a9: Arm9, n: int) -> list[dict]:
    """62 op62 k → 0x020aafd0 + k*0x2c: 4 点 × 2（当たり A, B）, u16 区画 A, B, 外れ"""
    out = []
    for k in range(n):
        d = a9.read(COURT_POINT + k * 0x2c, 0x2c)
        qa, qb = struct.unpack_from('<8h', d, 0), struct.unpack_from('<8h', d, 16)
        sa, sb, sm = struct.unpack_from('<3H', d, 32)
        out.append({'id': k, 'quad_a': [list(qa[i:i + 2]) for i in range(0, 8, 2)], 'section_a': sec(sa),
                    'quad_b': [list(qb[i:i + 2]) for i in range(0, 8, 2)], 'section_b': sec(sb), 'miss': sec(sm)})
    return out


def read_bgmap() -> dict:
    p = ROOT / 'assets/extracted/script/bg_map.tsv'
    if not p.exists():
        return {}
    out = {}
    for line in p.read_text().splitlines()[1:]:
        c = line.split('\t')
        out[int(c[0])] = 'assets/extracted/data/tail/bg/' + c[5] if len(c) > 5 and c[5] else None
    return out


def ocr(pngs: list[str]) -> dict[str, str]:
    """白地に 3 倍に拡大して ocr.swift で読む（読めなければ空）"""
    from PIL import Image
    res: dict[str, str] = {}
    with tempfile.TemporaryDirectory() as td:
        paths = []
        for i, p in enumerate(pngs):
            im = Image.open(ROOT / p).convert('RGBA')
            bg = Image.new('RGBA', im.size, 'white')
            bg.alpha_composite(im)
            q = f'{td}/{i}.png'
            bg.convert('RGB').resize((im.width * 3, im.height * 3)).save(q)
            paths.append(q)
        out = subprocess.run(['swift', str(ROOT / 'tools/rom/ocr.swift'), *paths], capture_output=True, text=True).stdout
        cur = None
        for line in out.splitlines():
            if line.startswith('# '):
                cur = pngs[int(Path(line[2:]).stem)]
                res[cur] = ''
            elif cur is not None and '\t' in line:
                res[cur] += line.split('\t', 1)[1].replace(' ', '')
    # 文字認識のよくある読み違い（場所の名前で確認したもの）
    fix = [('營', '警'), ('管察', '警察'), ('撮景・', '撮影所・')]
    for k, v in res.items():
        for a, b in fix:
            v = v.replace(a, b)
        res[k] = v.rstrip('。')
    return res


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        sys.exit(__doc__)
    a9 = Arm9(open(args[0], 'rb').read())
    out = Path(args[1]) if len(args) > 1 else ROOT / 'assets/extracted/tables/investigation.json'
    bgmap = read_bgmap()
    names = {'places': [{'id': i, 'ja': tex(PLACE_TEX['ja'], i), 'en': tex(PLACE_TEX['en'], i)} for i in range(N_PLACE_TEX)],
             'topics': [{'id': i, 'ja': tex(TOPIC_TEX['ja'], i), 'en': tex(TOPIC_TEX['en'], i)} for i in range(N_TOPIC_TEX)],
             'thumbs': [{'id': i, 'ja': tex(THUMB_TEX['ja'], i, THUMB_STEP), 'en': tex(THUMB_TEX['en'], i, THUMB_STEP)}
                        for i in range(29)]}
    if '--ocr' in sys.argv:
        pngs = [e['ja']['png'] for k in ('places', 'topics') for e in names[k] if e['ja']['png']]
        got = ocr(pngs)
        for k in ('places', 'topics'):
            for e in names[k]:
                e['name_ocr'] = got.get(e['ja']['png'])
    parts = [part_json(a9, p, bgmap) for p in range(PARTS)]
    for p in parts:
        for pl in p.get('places', []):
            if pl['id'] < N_PLACE_TEX:
                pl['name']['ocr'] = names['places'][pl['id']].get('name_ocr')
        for t in p.get('talk', []):
            for x in t['topics']:
                x['name_ocr'] = names['topics'][x['topic']].get('name_ocr') if x['topic'] < N_TOPIC_TEX else None
    from tbl_invest_rules import RULES  # 仕組みの説明（コードの番地つき）
    doc = {'about': __doc__.strip().splitlines()[0], 'rules': RULES, 'names': names,
           'court_point': court_point(a9, 13), 'parts': parts}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    inv = [p for p in parts if p['kind'] == 'investigation']
    print(f'{out}: 探偵パート {len(inv)} 個、場所 {sum(len(p["places"]) for p in inv)}、'
          f'話題の項目 {sum(len(p["talk"]) for p in inv)}、調べる表 {sum(len(p["examine_tables"]) for p in inv)}')


if __name__ == '__main__':
    main()
