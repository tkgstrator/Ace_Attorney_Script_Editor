"""命令 26（法廷の視点の流し = パン）を 1 フレームずつ再現する（tbl_bg_render.py から使う）。

ARM9 から読み取ったこと（番地は ARM9）:
  命令 26 a b c d（0x0202a480）: 最初の実行は 1 フレーム止まるだけ（+0x1c の印を立てて同じ命令をやり直す）。
    2 回目で 0x0202c158(a, b, c, d) と 0x02017f44 を呼んで**すぐ次の命令へ進む**（台本は止まらない。台本の wait 30 で待つ）。
    種類 = 2a + (b & 1)（0x020ce16c+6）、c = 到着側の人物、d = その動き。b != 0 が「動いている」印（+4）。
    パンの絵は data.bin 0x21f2f00 の 62240 バイト（無圧縮: 16 色のパレット 32 バイト + 4bpp タイル 81 × 24 枚）を読む。
  カウンタ（+0xc）: b & 1 = 0 なら 0 から、1 なら 30 から（0x02017f44）。毎フレーム 0x02019490 → 0x02017e88 で
    ±1。31 以上 / 0 未満になったらパンは終わり（+4 = 0）。同じフレームで 人物（0x02020b20 → 0x0202c184）→ 背景（0x0201f114）の順に動く。
    つまり命令が動いたフレームから数えて k = 1..30 フレーム目の値は 前向き c = k、後ろ向き c = 30 - k（c = 0 / 30 の片方は使われない）。
  背景（0x0201f114）: c が偶数のフレームだけ BG3 を描き直す。左端のタイル位置 t =
    種類 0/1: SHORT[c/2]、2/3: 130 - LONG[c/2]、4/5: 130 - SHORT[c/2]（SHORT = 0x020b3dc0、LONG = 0x020b3de0）。
    仮想のパノラマは 162 タイル（1296 px）幅: 列 v < 81 は絵の列 v、v >= 81 は絵の列 161 - v を左右反転（タイルの 0x400）。
    t = 0 弁護側、65 証言台、130 検察側。描き直さないフレーム（c が奇数）は前の絵のまま。k = 1 はまだ元の背景。
  人物（種類ごとの関数 0x020b4784[種類]）: 主の人物（0x020d2f48）とその付属の物体の x をバイトの表で毎フレーム動かし、
    c が 14（短い）/ 15（長い）のフレームで到着側の人物 (c, d) を x0, y = 96 に作り直す。机（OBJ）も同じ関数が動かす。
"""
import struct

B = 0x02000000
SHORT, LONG = 0x020b3dc0, 0x020b3de0          # u16 × 16（タイル）
T1, T3, T2 = 0x020ab20c, 0x020ab22c, 0x020ab24c  # s8 × 32（人物の 1 フレームの移動量）
PAN_IMAGE = (0x21f2f00, 62240)               # data.bin の位置と大きさ
TILES_W, TILES_H = 81, 24
DESK_REST = {'defense': 0, 'witness': 32, 'prosecution': 48}   # 机の関数に渡す x の定位置（0x0202cbe0 / cd9c / caa8）

TYPES = {
    0: ('弁護側 → 証言台', 'fwd', 'short'), 1: ('証言台 → 弁護側', 'rev', 'short'),
    2: ('検察側 → 弁護側', 'fwd', 'long'), 3: ('弁護側 → 検察側', 'rev', 'long'),
    4: ('検察側 → 証言台', 'fwd', 'short130'), 5: ('証言台 → 検察側', 'rev', 'short130'),
}
FUNCS = {0: 0x0202c31c, 1: 0x0202c1bc, 2: 0x0202c914, 3: 0x0202c784, 4: 0x0202c600, 5: 0x0202c4a0}
ARRIVE = {0: (14, 0x14c), 1: (14, 0x1c), 2: (15, -0x66), 3: (15, 0x166), 4: (14, -0x4c), 5: (14, 0xe4)}


def tables(a: bytes, addrs: tuple = (SHORT, LONG, T1, T3, T2)) -> dict:
    u16 = lambda addr, n: list(struct.unpack_from(f'<{n}H', a, addr - B))  # noqa: E731
    s8 = lambda addr: list(struct.unpack_from('<32b', a, addr - B))          # noqa: E731
    short, long_, t1, t3, t2 = addrs
    return {'short': u16(short, 16), 'long': u16(long_, 16), 't1': s8(t1), 't2': s8(t2), 't3': s8(t3)}


def _tile(t: dict, typ: int, i: int) -> int:
    kind = TYPES[typ][2]
    if kind == 'short':
        return t['short'][i]
    if kind == 'long':
        return 130 - t['long'][i]
    return 130 - t['short'][i]


def _move(t: dict, typ: int, c: int) -> int:
    """その c での主の人物の x の変化"""
    t1, t2, t3 = t['t1'], t['t2'], t['t3']
    return {0: -t1[c], 1: t2[c], 2: t3[c], 3: -t3[30 - c], 4: t1[c], 5: -t2[c]}[typ]


def _desk(t: dict, typ: int, c: int, x: int):
    """その c での机（種類, 関数に渡す x）。None = このフレームは机を動かさない"""
    t1, t3 = t['t1'], t['t3']
    s = lambda tab, lo, hi: sum(tab[lo:hi + 1]) if hi >= lo else 0  # noqa: E731
    if typ == 0:
        return ('witness', 0xec - s(t1, 16, c)) if c >= 16 else ('defense', -s(t1, 1, c))
    if typ == 1:
        return ('witness', 0xec - s(t1, 15, c - 1)) if c > 14 else ('defense', x - 0x80)
    if typ == 2:
        r = s(t3, 1, c)
        return ('defense', r - 487) if c >= 20 else ('prosecution', r + 0x30) if c <= 10 else None
    if typ == 3:
        if c >= 18:
            return ('defense', -sum(t3[30 - i] for i in range(c, 31)))
        return ('prosecution', sum(t3[30 - i] for i in range(c)) + 0x30)
    if typ == 4:
        return ('witness', s(t1, 16, c) - 0xac) if c >= 16 else ('prosecution', s(t1, 1, c) + 0x30)
    return ('witness', s(t1, 15, c - 1) - 0xac) if c >= 13 else ('prosecution', x - 0x50)


def simulate(t: dict, typ: int) -> list[dict]:
    """k = 1..31 の各フレームの状態（k = 31 はパンが終わったフレーム）"""
    fwd = TYPES[typ][1] == 'fwd'
    at, x0 = ARRIVE[typ]
    x, who, tile, desk, out = 128, 'departing', None, None, []
    for k in range(1, 32):
        c = k if fwd else 30 - k
        if k == 31:
            out.append({'k': k, 'counter': c, 'active': False, 'bg_tile': tile, 'bg_x': tile * 8,
                        'char': who, 'char_x': x, 'desk': desk})
            break
        x += _move(t, typ, c)
        if c == at:
            x, who = x0, 'arriving'
        if c % 2 == 0:
            tile = _tile(t, typ, c // 2)
        d = _desk(t, typ, c, x)
        if d:
            desk = {'kind': d[0], 'x': d[1], 'dx': d[1] - DESK_REST[d[0]]}
        out.append({'k': k, 'counter': c, 'active': True, 'bg_tile': tile,
                    'bg_x': None if tile is None else tile * 8, 'char': who, 'char_x': x, 'desk': desk})
    return out


def spec(a: bytes, pan: tuple = PAN_IMAGE, addrs: tuple = (SHORT, LONG, T1, T3, T2), funcs: dict = FUNCS) -> dict:
    t = tables(a, addrs)
    name = f'data/tail/bg_fixed/court_pan_{pan[0]:07x}'
    return {
        '_about': '命令 26 a b c d（bg_scroll）のパン。種類 = 2a + (b & 1)。frames[k-1] = 命令が動いた（2 回目の実行の）'
                  'フレームを k = 1 とした各フレームの終わりの状態。bg_x = パノラマ（court_pan_1296x192.png）の左端の x'
                  '（None = まだ元の背景のまま）。char_x = 主の人物の原点の x（y = 96）。char = departing（元の人物）/ '
                  'arriving（c, d で作り直した人物）。desk = 机の OBJ（kind の机を dx だけ定位置からずらして描く）',
        'image': {'data_bin': pan[0], 'size': pan[1], 'palette_bytes': 32, 'bpp': 4,
                  'tiles': [TILES_W, TILES_H], 'mirror': 'v >= 81 のタイル列は 161 - v を左右反転',
                  'png_half': f'{name}_648x192.png',
                  'png_full': f'{name}_1296x192.png',
                  'bg_layer': 'BG3（16 色、パレット 2）。パンが終わっても次の 27 bg が読み込まれるまで最後の絵が残る'},
        'rest_tile': {'defense': 0, 'witness': 65, 'prosecution': 130},
        'counter': '前向き（b & 1 = 0）: c = k。後ろ向き（b & 1 = 1）: c = 30 - k。k = 31 で終わり',
        'tables': t,
        'types': {str(typ): {'label': TYPES[typ][0], 'direction': TYPES[typ][1], 'func': hex(funcs[typ]) if typ in funcs else None,
                             'arrive_counter': ARRIVE[typ][0], 'arrive_x': ARRIVE[typ][1],
                             'frames': simulate(t, typ)} for typ in TYPES},
    }


#: 2・3: 命令 26（2: 0x0202b150、3: 0x0202d0e8）が読むパンの絵の位置と、表（蘇る逆転とバイト単位で同じ内容の所）。
#: 人物・机の動かし方（FUNCS・ARRIVE）は蘇る逆転と同じとみなした（表が同じで、2・3 は蘇る逆転の作りを元にしているため。確かさ 中）
PAN_23 = {
    'A2GJ': ((0x5193c0, 62240), (0x020950e8, 0x02095108, 0x0208ccd4, 0x0208ccf4, 0x0208cd14)),
    'YG3J': ((0x4aefb4, 62240), (0x020ad6d4, 0x020ad6f4, 0x020a4374, 0x020a4394, 0x020a43b4)),
}


def spec_23(a: bytes, code: str) -> dict | None:
    """2・3 のパン（絵の位置と表の番地だけ違う）"""
    if code not in PAN_23:
        return None
    pan, addrs = PAN_23[code]
    return spec(a, pan, addrs, {})
