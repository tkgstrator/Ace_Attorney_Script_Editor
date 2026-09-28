# /// script
# requires-python = ">=3.11"
# ///
"""法廷パートの表（証言・尋問・ゆさぶる・つきつける・体力）を ARM9 と台本から書き出す。ROM は変更しない。

    uv run tools/rom/tbl_court.py <rom.nds> [出力（assets/extracted/tables/court.json）]

ARM9 から読むもの（番地はコードで確認済み）:
  - つきつけの正解の表 0x020b44c8: u32 ポインター × 35（添字 = パートの番号 game+0x69。項目 = 2 × パート + 言語）。
    各表は 8 バイトの行の並びで、先頭の u16 が 0xffff で終わる:
      u16 区画 + 128（つきつけたときの今の区画 = 文脈 +0x4a）, u16 証拠品/人物の番号（法廷記録の番号）,
      u16 飛び先の区画 + 128, u8 フラグ（0xff = 条件なし。それ以外は組 0 のそのフラグが立っているときだけ有効）,
      u8 窓（0 なら文脈 +0x5f = 1 → 飛ぶとき game+0x24 = 1・文脈 +0x2d = 1。15 の第 2 引数 1 と同じ）
    照合は 0x02030550(区画, 番号)。呼ぶのは法廷記録の「つきつける」の処理 0x020311c4（「異議あり!」の後）:
      一致 → その区画へ。
      不一致・文脈 +0 のビット 0x10 あり（17/33 のつきつけ要求）→ 今の区画 + 1 へ。
      不一致・尋問中 → 共通の台本（項目 072/073）の区画 45〜48 のどれか（乱数 & 3）へ行き、
                       次の区画（+0x4c）= 今の証言の区画（共通の区画の最後の end で証言に戻る）。
  - ゲームオーバーの区画 0x020aad40: u16 × パート（区画 + 128。0 = なし）。43 が体力を 0 以下にしたとき次の区画にする。
  - 体力: game(0x020ceda8)+0x6b（符号付き 8 ビット）。新しく始めるとき・話を選んで始めるとき 5（0x0202f928, 0x02036340）。
    減らすのは台本の 43 だけ（1 回で 1）。表示は「!」5 個（0x0202d108: 5 - 体力 個を消す）。

台本（mes_all.bin）から読むもの:
  - 40 1 の区画 = 証言の始まり（「証言開始」）、40 0 のある区画まで = 証言の文。
  - 41 1 の区画 = 尋問の始まり（「尋問開始」、この区画 = game+0x2c で「戻る」の下限）。同じ区画の 111 = 最後の文の次の区画。
  - 尋問の文 = 41 1 の次から続く、21/69/121（player_turn）を持つ区画。15 = (ゆさぶる先 + 128, 窓（1 = 閉じたまま始める）)。
  - 17/33 の区画 = つきつけ要求。

区画の番号はすべて「区画そのもの」（+128 を外した値）。項目の見出しの末尾のラベル（区画 << 16 | 位置）は labels に。
"""
import json
import os
import struct
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from arm9 import Arm9  # noqa: E402
from charset import CODE_BASE  # noqa: E402
from script_dump import decode, entries, load_chars, read_mes, text  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
PRESENT_TABLE = 0x020b44c8     # u32 × パート → 8 バイトの行の並び
GAMEOVER_TABLE = 0x020aad40    # u16 × パート
N_PARTS = 35                   # 項目 000〜068（070 = 3D の台詞、072 = 共通の台本）
COMMON_ITEM = 72               # 共通の台本（0x020db020 に読む。区画 < 0x80）
COMMON_WRONG = [45, 46, 47, 48]
TURN = (21, 69, 121)           # player_turn（同じ関数 0x0202a7f8）


def split(e: list[int]) -> tuple[list[list[int]], dict[int, list[int]]]:
    """項目を区画とラベルに分ける。ラベル = 見出しの末尾の、単調に増えない/大きさを超える値"""
    n = e[0] | e[1] << 16
    offs = [e[2 + 2 * k] | e[3 + 2 * k] << 16 for k in range(n)]
    size = len(e) * 2
    real = n
    for k in range(1, n):
        if offs[k] < offs[k - 1] or offs[k] >= size:
            real = k
            break
    bounds = [o // 2 for o in offs[:real]] + [len(e)]
    secs = [e[bounds[k]:bounds[k + 1]] for k in range(real)]
    labels = {k: [offs[k] >> 16, offs[k] & 0xffff] for k in range(real, n)}
    return secs, labels


def ops(sec: list[int]) -> list[tuple]:
    return decode(sec)


def has(d: list[tuple], op: int, arg0: int | None = None) -> bool:
    return any(t[0] == op and (arg0 is None or t[1][0] == arg0) for t in d)


def first(d: list[tuple], op: int) -> tuple | None:
    return next((t[1] for t in d if t[0] == op), None)


def colored_text(d: list[tuple], chars: dict[int, str], color: int | None = 3) -> str:
    """色 color の文（None なら全部）をつなげる"""
    cur, out = 0, []
    for t in d:
        if t[0] == 3:
            cur = t[1][0]
        elif t[0] == 1:
            out.append('\n')
        elif t[0] == 'T' and (color is None or cur == color):
            out.append(text(t[1], chars))
    return ''.join(out).strip()


def title(d: list[tuple], chars: dict[int, str]) -> str:
    """証言の題（赤い文のうち ～ で始まる行。無ければ最初の行）"""
    lines = [x for x in colored_text(d, chars, 1).split('\n') if x.strip()]
    return next((x for x in lines if x.startswith('～')), lines[0] if lines else '')


def read_present(a: Arm9, part: int) -> list[dict]:
    p = a.u32(PRESENT_TABLE + 4 * part)
    rows = []
    while a.u16(p) != 0xffff:
        sec, item, dest, flag, keep = struct.unpack('<HHHBB', a.read(p, 8))
        rows.append({'section': sec - 128, 'item': item, 'goto': dest - 128,
                     'flag': None if flag == 0xff else flag, 'box_closed': keep == 0,
                     'dead': item > 0xff})  # 番号は u8 と比べるので 0xff を超える行は一致しない
        p += 8
    return rows


def item_kinds(ents: list[list[int]]) -> dict[int, str]:
    """法廷記録の番号 → evidence / profile（23/24/25 の使われ方から）"""
    kinds: dict[int, str] = {}
    for e in ents[0::2]:
        for s in split(e)[0]:
            for t in ops(s):
                if t[0] in (23, 24, 25):
                    for x in t[1]:
                        kinds[x & 0x3fff] = 'profile' if x & 0x8000 else 'evidence'
    return kinds


def press_end(d: list[tuple]) -> dict | None:
    """ゆさぶりの区画の終わり方（戻り先）"""
    for t in reversed(d):
        if t[0] == 44:
            return {'op': 'jump_after', 'goto': t[1][0] - 128}
        if t[0] == 42:
            return {'op': 'testimony_jump', 'flag': t[1][0], 'if_set': t[1][1] - 128, 'else': t[1][2] - 128}
        if t[0] in (10, 32):
            return {'op': 'page_jump' if t[0] == 10 else 'set_next', 'goto': t[1][0] - 128}
        if t[0] in (54, 120):
            return {'op': 'jump', 'label': t[1][0]}
    return None


def flag53(a: tuple) -> dict:
    """53 の引数（フラグ << 8 | 0x80? | 期待値, 飛び先）"""
    f, want = a[0] >> 8, a[0] & 1
    return {'flag': f, 'value': want, 'goto': a[1]} if a[0] & 0x80 else {'flag': f, 'value': want, 'skip_bytes': a[1]}


def is_statement(d: list[tuple]) -> bool:
    """尋問の文: 15 を持つか、ページ送り（2/10/45）無しで 21/69/121 を持つ。つきつけ要求（17/33）は除く"""
    if has(d, 17) or has(d, 33):
        return False
    return has(d, 15) or (any(has(d, o) for o in TURN) and not any(has(d, o) for o in (2, 10, 45)))


def region(ds: list[list[tuple]], k: int) -> list[int]:
    """41 1 の区画 k から、次の証言（40 1）・尋問（41 1）・尋問の終わり（41 0）・話の終わり（22/36）までの文の区画"""
    out = []
    for j in range(k + 1, len(ds)):
        d = ds[j]
        if has(d, 40, 1) or has(d, 41, 1) or has(d, 41, 0) or has(d, 22):
            break
        if is_statement(d):
            out.append(j)
    return out


def connector(d: list[tuple]) -> dict | None:
    """文の次の区画が文字の無い「つなぎ」（44/42/53 だけ）なら、その行き先"""
    if any(t[0] == 'T' for t in d) or any(has(d, o) for o in TURN):
        return None
    r = press_end(d)
    flags = [flag53(t[1]) for t in d if t[0] == 53]
    return {**(r or {}), 'if_flags': flags} if (r or flags) else None


def penalty(d: list[tuple], labels: dict) -> dict:
    """区画の中の体力の減り（43 の数）とゲームオーバーの確かめ（122）"""
    go = first(d, 122)
    return {'life_loss': sum(1 for t in d if t[0] == 43),
            'if_gameover': None if go is None else {'label': go[0], 'at': labels.get(go[0])}}


def parse_part(part: int, secs: list[list[int]], labels: dict, table: list[dict], chars, kinds) -> dict:
    ds = [ops(s) for s in secs]
    used = set()

    def presents(sec: int) -> list[dict]:
        out = []
        for i, r in enumerate(table):
            if r['section'] == sec and not r['dead']:
                used.add(i)
                out.append({'item': r['item'], 'kind': kinds.get(r['item'], '?'), 'goto': r['goto'],
                            'flag': r['flag'], 'box_closed': r['box_closed']})
        return out

    testimonies, crosses, requests = [], [], []
    for k, d in enumerate(ds):
        if has(d, 40, 1):
            end = next((j for j in range(k, len(ds)) if has(ds[j], 40, 0)), k)
            testimonies.append({'section': k, 'title': title(d, chars),
                                'statements': list(range(k + 1, end + 1)), 'end': end})
        if has(d, 41, 1):
            dj = first(d, 111)
            after = dj[0] - 128 if dj else None
            stm = []
            for j in region(ds, k):
                p = first(ds[j], 15)
                press = p[0] - 128 if p and p[0] >= 128 else None
                nxt = j + 1
                stm.append({'section': j, 'text': colored_text(ds[j], chars),
                            'press': press, 'press_box_closed': bool(p[1]) if p else None,
                            'press_return': press_end(ds[press]) if press is not None and press < len(ds) else None,
                            'present': presents(j),
                            'if_flags': [flag53(t[1]) for t in ds[j] if t[0] == 53],
                            'next': nxt, 'next_route': connector(ds[nxt]) if nxt < len(ds) else None})
            src = [t for t in testimonies if t['section'] < k]
            crosses.append({'section': k, 'title': title(d, chars),
                            'testimony': src[-1]['section'] if src else None,
                            'after_last': after, 'statements': stm,
                            'after_last_return': press_end(ds[after]) if after is not None and after < len(ds) else None})
        for op in (17, 33, 116):
            if (op != 116 and has(d, op)) or (op == 116 and has(d, 116, 11)):
                w = k + 1
                # 116 11 = 法廷記録を直接開く（game+8 = 7、0x020d3974+0xe9e = 1）。+0x10 が無いので外れは共通の区画（推測）
                requests.append({'section': k, 'op': op if op != 116 else 'ds_116_11', 'life_gauge': op == 33,
                                 'prompt': colored_text(d, chars, None)[-60:],
                                 'correct': presents(k), 'wrong': w,
                                 'wrong_penalty': penalty(ds[w], labels) if w < len(ds) else None,
                                 'wrong_return': press_end(ds[w]) if w < len(ds) else None})
    others = [dict(r, kind=kinds.get(r['item'], '?')) for i, r in enumerate(table) if i not in used]
    op43 = [k for k, d in enumerate(ds) if has(d, 43)]
    return {'testimonies': testimonies, 'cross_examinations': crosses, 'present_requests': requests,
            'present_other': others, 'sections_with_penalty': op43, 'labels': labels}


def check_en(jp: list[list[int]], en: list[list[int]], part: dict) -> list[str]:
    """英語の項目で、尋問・要求の区画の命令（15/21/17/33/41/111）が同じか確かめる"""
    bad = []
    keys = (15, 17, 21, 33, 41, 69, 111, 121)
    secs = [c['section'] for c in part['cross_examinations']] + \
           [s['section'] for c in part['cross_examinations'] for s in c['statements']] + \
           [r['section'] for r in part['present_requests']]
    for k in secs:
        a = [t for t in ops(jp[k]) if t[0] in keys]
        b = [t for t in ops(en[k]) if t[0] in keys] if k < len(en) else None
        if a != b:
            bad.append(f'§{k}')
    return bad


def common_wrong(ents, chars) -> list[dict]:
    secs, labels = split(ents[COMMON_ITEM])
    out = []
    for k in COMMON_WRONG:
        d = ops(secs[k])
        out.append({'section': k, **penalty(d, labels),
                    'court_mode': [t[1][0] for t in d if t[0] == 41],
                    'first_line': colored_text(d, chars, None).split('\n')[0]})
    return out


DOC = {
    'format': 'パートごと（part = game+0x69、項目 = 2*part（日本語）/ 2*part+1（英語））。区画の番号は +128 を外した値。',
    'present_table': 'ARM9 の表そのまま: section でつきつけると goto へ。flag = 組 0 のフラグが立っているときだけ有効'
                     '（null = 条件なし）。box_closed = 表の最後のバイトが 0（文脈 +0x5f = 1 → 飛ぶときに game+0x24 = 1・文脈 +0x2d = 1。15 の第 2 引数 = 1 と同じ処理）。'
                     'dead = 番号が 255 を超えるので一致しない行。',
    'cross_examinations': 'section = 41 1 の区画。statements = 尋問の文（「次へ」= 次の区画（文脈 +0x4c、既定は区画 + 1）、'
                          '「戻る」= 区画 - 1。ただし 1 つ目の文では戻れない）。press = 15 のゆさぶる先、press_box_closed = 15 の第 2 引数'
                          '（1 のとき 0x0202e43c で game+0x24 = 1・文脈 +0x2d = 1、0 のとき 0x0201c4b4(3) で両方 0。'
                          '1 のゆさぶりの区画は 42/41 個が最初の文より前に [box 1] を持つ）。'
                          'present = この文で正解になる証拠品 → 飛び先。表に無い物をつきつけたら common_wrong（乱数）へ行き、同じ文に戻る。'
                          'after_last = 111 の値（最後の文の「次へ」の行き先。ARM9 は右矢印を隠すのに使うだけ）。',
    'present_requests': '17/33 の区画。correct = 表の行、wrong = 区画 + 1（表に無い物全部）。wrong_penalty = その区画の 43 の数と 122。',
    'life': '最大 5、43 で 1 減る。0 以下になったら次の区画 = gameover_section。',
}


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    rom = open(sys.argv[1], 'rb').read()
    out = Path(sys.argv[2] if len(sys.argv) > 2 else ROOT / 'assets/extracted/tables/court.json')
    a = Arm9(rom)
    ents = entries(read_mes(sys.argv[1]))
    chars = load_chars()
    kinds = item_kinds(ents)
    parts, warn = [], []
    for part in range(N_PARTS):
        jp, labels = split(ents[2 * part])
        en, _ = split(ents[2 * part + 1])
        table = read_present(a, part)
        go = a.u16(GAMEOVER_TABLE + 2 * part)
        info = parse_part(part, jp, labels, table, chars, kinds)
        bad = check_en(jp, en, info)
        if bad:
            warn.append(f'part {part}: 英語で違う区画 {bad}')
        parts.append({'part': part, 'items': [2 * part, 2 * part + 1],
                      'gameover_section': go - 128 if go else None,
                      'present_table_addr': hex(a.u32(PRESENT_TABLE + 4 * part)),
                      'present_table': table, **info})
    doc = {'_doc': DOC, 'life_max': 5, 'common_item': COMMON_ITEM,
           'common_wrong': common_wrong(ents, chars), 'parts': parts, 'warnings': warn}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    n_st = sum(len(c['statements']) for p in parts for c in p['cross_examinations'])
    n_rq = sum(len(p['present_requests']) for p in parts)
    print(f'{out}: 尋問 {sum(len(p["cross_examinations"]) for p in parts)} 個（文 {n_st}）、'
          f'つきつけ要求 {n_rq} 個、警告 {len(warn)}')
    for w in warn:
        print(' ', w)


if __name__ == '__main__':
    main()
