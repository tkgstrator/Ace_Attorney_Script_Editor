"""下画面の UI 部品（OBJ）108 個の名前・用途・パレットと、スクリーンショットで確かめた置き場所。ex_ui.py から使う。

パレットの確かさ:
  確実 = スクリーンショットと不透明な画素がすべて一致（または ARM9 のコードで描くときのパレットを確認）
  中   = 同じ種類の部品が一致したパレット（ボタンは茶色 0x2f51288 など）
  推測 = 画面の例が無い（第 5 話の道具など）。形と色の並びから選んだ
"""

P_FRAME = 0x2f51268    # 枠・マイクの印（OBJ パレット 5。0x02038cdc で確認）
P_BUTTON = 0x2f51288   # 茶色のボタン（OBJ パレット 2）
P_BUTTON_ON = 0x2f512a8  # 黄色いボタン（押した・選んだときと思われる。推測）
P_TITLE = 0x2f51368    # 左上の題の札（OBJ パレット 6）
P_EP5 = 0x2f51528      # 第 5 話の道具の画面で読み込まれるパレット（推測）
P_SHOUT = 0x2f51548    # 赤の濃淡（推測）
P_MENU = 0x2f51348     # 黒・灰・白・青緑（OBJ パレット 4。第 5 話のメニューの文字が読める色。推測）

# 番号: (名前, 用途, パレット, 確かさ)
PARTS: dict[int, tuple[str, str, int, str]] = {
    0: ('frame_bar', '画面の上下の帯（16×32。上は横 2 倍に拡大して描く、下は 2 個並べる）', P_FRAME, '確実'),
    1: ('frame_corner_a', '帯の角', P_FRAME, '中'),
    2: ('frame_corner_b', '帯の角', P_FRAME, '中'),
    3: ('frame_title_end', '左上の題の札の右端の斜め（x=64, y=0）', P_FRAME, '確実'),
    4: ('frame_corner_d', '帯の角', P_FRAME, '中'),
    5: ('btn_next', '「▶」ボタン（80×32）', P_BUTTON, '中'),
    6: ('btn_kettei', '「決定」ボタン', P_BUTTON, '中'),
    7: ('btn_modoru', '「もどる」ボタン（左下 0,160）', P_BUTTON, '確実'),
    8: ('btn_tsukitsukeru_s', '「つきつける」ボタン（小）', P_BUTTON, '中'),
    9: ('btn_houtei_kiroku', '「法廷記録」ボタン（右上 176,0）', P_BUTTON, '確実'),
    10: ('btn_houtei_kiroku_b', '「法廷記録」ボタン（別の形。押したとき・出入りの途中と思われる）', P_BUTTON, '中'),
    11: ('tab_jinbutsu_file', '「▶人物ファイル」切り替え（証拠品の画面の右上 176,0）', P_BUTTON, '確実'),
    12: ('btn_lr_a', '「←→」ボタン（48×32）', P_BUTTON, '中'),
    13: ('btn_ffwd', '「▶▶」ボタン（64×32）', P_BUTTON, '中'),
    14: ('btn_lr_b', '「←→」ボタン（別の向き）', P_BUTTON, '中'),
    15: ('btn_rew', '「◀◀」ボタン', P_BUTTON, '中'),
    16: ('btn_shousai', '「詳細」ボタン', P_BUTTON, '中'),
    17: ('btn_shiraberu', '「調べる」ボタン', P_BUTTON, '中'),
    18: ('btn_tsukitsukeru', '「つきつける」ボタン（証拠品の詳細の上 88,0）', P_BUTTON, '確実'),
    19: ('btn_tsukitsukeru_ce', '「つきつける」ボタン（尋問の右上 176,0）', P_BUTTON, '確実'),
    20: ('btn_yusaburu', '「ゆさぶる」ボタン（尋問の左上 0,0）', P_BUTTON, '確実'),
    21: ('btn_kumitateru', '「くみたてる」ボタン', P_BUTTON, '中'),
    22: ('btn_pause', '「‖」ボタン', P_BUTTON, '中'),
    23: ('tab_shoukohin_file', '「▶証拠品ファイル」切り替え（人物の画面の右上 176,0）', P_BUTTON, '確実'),
    24: ('btn_modoru_b', '「もどる」ボタン（別の形）', P_BUTTON, '中'),
    25: ('btn_fukitsukeru', '「ふきつける」ボタン（第 5 話）', P_BUTTON, '中'),
    26: ('btn_b_iie', '「B いいえ」ボタン（96×32）', P_BUTTON, '中'),
    27: ('btn_a_hai', '「A はい」ボタン（96×32）', P_BUTTON, '中'),
    28: ('btn_kettei_b', '「決定」ボタン（話の選択の右下 176,160）', P_BUTTON, '確実'),
    29: ('icon_x', '▲ と X の印', P_FRAME, '推測'),
    30: ('icon_v', '▼ と V の印', P_FRAME, '推測'),
    31: ('icon_tab', '小さな札', P_FRAME, '推測'),
    32: ('icon_lr', '◀▶ の小さな印', P_FRAME, '推測'),
    33: ('icon_ud', '▲▼ の小さな印', P_FRAME, '推測'),
    34: ('arrow_tab_up', '矢印の札（上向き）', P_FRAME, '推測'),
    35: ('arrow_tab_down', '矢印の札（下向き）', P_FRAME, '推測'),
    36: ('arrow_tab_left', '矢印の札（左向き）', P_FRAME, '推測'),
    37: ('arrow_tab_right', '矢印の札（右向き）', P_FRAME, '推測'),
    38: ('bar_v_a', '縦長の棒（16×96）', P_FRAME, '推測'),
    39: ('bar_v_b', '縦長の棒（16×96）', P_FRAME, '推測'),
    40: ('arrow_l', '◀（小）', P_FRAME, '推測'),
    41: ('arrow_r', '▶（小）', P_FRAME, '推測'),
    42: ('btn_shougou', '「照合」ボタン（第 5 話）', P_BUTTON, '中'),
    43: ('btn_kenshutsu', '「検出」ボタン（第 5 話）', P_BUTTON, '中'),
    44: ('btn_yameru', '「やめる」ボタン', P_BUTTON, '中'),
    45: ('btn_next_end', '「▶|」ボタン', P_BUTTON, '中'),
    46: ('btn_prev_end', '「|◀」ボタン', P_BUTTON, '中'),
    47: ('menu_idou', '探偵のメニュー「移動する」（第 5 話の形）', P_MENU, '推測'),
    48: ('menu_shiraberu', '探偵のメニュー「調べる」', P_MENU, '推測'),
    49: ('menu_tsukitsukeru', '探偵のメニュー「つきつける」', P_MENU, '推測'),
    50: ('menu_hanasu', '探偵のメニュー「話す」', P_MENU, '推測'),
    51: ('menu_luminol', '「ルミノール」', P_MENU, '推測'),
    52: ('menu_shimon', '「指紋照合」', P_MENU, '推測'),
    53: ('menu_saisei', '「再生」', P_MENU, '推測'),
    54: ('corner_small', '小さな斜めの角', P_FRAME, '推測'),
    55: ('title_jinbutsu', '左上の題「人物」（0,0）', P_TITLE, '確実'),
    56: ('title_shoukohin', '左上の題「証拠品」（0,0）', P_TITLE, '確実'),
    57: ('plate_strip', '札の帯', P_TITLE, '推測'),
    58: ('fill_a', '塗りつぶし 16×16', P_BUTTON, '推測'),
    59: ('fill_b', '塗りつぶし 16×16', P_BUTTON, '推測'),
    60: ('fill_c', '塗りつぶし 16×16', P_BUTTON, '推測'),
    61: ('icon_plus_box', '□に＋', P_TITLE, '推測'),
    62: ('fill_d', '（1 KB の部品。先頭 16×16 だけ描く）', P_BUTTON, '推測'),
    63: ('dot_a', '8×8 の点', P_FRAME, '推測'),
    64: ('dot_b', '8×8 の点', P_FRAME, '推測'),
    65: ('title_file', '左上の題「ファイル」（32,0）。84・85 は同じ絵', P_TITLE, '確実'),
    66: ('plate_end', '札の端', P_TITLE, '推測'),
    67: ('corner_c', '角', P_TITLE, '推測'),
    68: ('dot_c', '8×8 の点', P_FRAME, '推測'),
    69: ('corner_d', '角', P_TITLE, '推測'),
    70: ('title_shimon', '左上の題「指紋」（第 5 話）', P_TITLE, '中'),
    71: ('cursor_plus', '十字の印', P_FRAME, '推測'),
    72: ('icon_mic', 'マイクの印「Y(•)」（尋問の上 80,0）', P_FRAME, '確実'),
    73: ('btn_b_modoru', '「B もどる」（第 5 話）', P_EP5, '推測'),
    74: ('btn_a_kenshutsu', '「A 検出」（第 5 話）', P_EP5, '推測'),
    75: ('shout_matta', '「待った!」の文字', P_SHOUT, '推測'),
    76: ('shout_igiari', '「異議あり!」の文字', P_SHOUT, '推測'),
    77: ('shout_kurae', '「くらえ!」の文字', P_SHOUT, '推測'),
    78: ('btn_blank_a', '文字の無いボタンの形', P_BUTTON, '中'),
    79: ('btn_blank_b', '文字の無いボタンの形（逆向き）', P_BUTTON, '中'),
    80: ('toggle_on_0', '「ON」の切り替え', P_EP5, '推測'),
    81: ('toggle_on_1', '「ON」の切り替え', P_EP5, '推測'),
    82: ('toggle_on_2', '「ON」の切り替え', P_EP5, '推測'),
    83: ('toggle_on_3', '「ON」の切り替え', P_EP5, '推測'),
    84: ('title_file_b', '「ファイル」（65 と同じ絵）', P_TITLE, '確実'),
    85: ('title_file_c', '「ファイル」（65 と同じ絵）', P_TITLE, '確実'),
    86: ('digit_1', '数字 1', P_EP5, '推測'),
    87: ('digit_2', '数字 2', P_EP5, '推測'),
    88: ('digit_3', '数字 3', P_EP5, '推測'),
    89: ('digit_4', '数字 4', P_EP5, '推測'),
    90: ('digit_5', '数字 5', P_EP5, '推測'),
    91: ('digit_6', '数字 6', P_EP5, '推測'),
    92: ('digit_7', '数字 7', P_EP5, '推測'),
    93: ('digit_8', '数字 8', P_EP5, '推測'),
    94: ('digit_9', '数字 9', P_EP5, '推測'),
    95: ('label_kakera_no', '「カケラ NO.」', P_EP5, '推測'),
    96: ('corner_e', '角', P_EP5, '推測'),
    97: ('corner_f', '角', P_EP5, '推測'),
    98: ('corner_g', '角', P_EP5, '推測'),
    99: ('corner_h', '角', P_EP5, '推測'),
    100: ('gauge_a', '8 段のゲージ（128×16）', P_EP5, '推測'),
    101: ('corner_i', '角', P_EP5, '推測'),
    102: ('corner_j', '角', P_EP5, '推測'),
    103: ('corner_k', '角', P_EP5, '推測'),
    104: ('corner_l', '角', P_EP5, '推測'),
    105: ('gauge_b', '8 段のゲージ（128×16）', P_EP5, '推測'),
    106: ('frame_32', '32×32 の枠（2 KB の部品。先頭だけ描く）', P_EP5, '推測'),
    107: ('check_mark', 'チェックの印（画素は 0x1a978f4、生のタイルの領域）', P_EP5, '推測'),
}

# スクリーンショットで確かめた置き場所: (場面のフォルダ, 部品, x, y, 描き方)。後に書いたものほど手前。
# 描き方: 'h' 左右反転 / 'v' 上下反転 / '2' 横 2 倍（上の帯は 0x02043bd4 が拡大率 200%・100% のアフィンで描く）。
# 帯の並べ方は ARM9 の表 0x020bcb44（0xa6 バイト × 場面、上下 2 組、10 バイトの項目 {種類, ?, x, y, 左右, 上下}）と同じ。
RECORD_SCENES = ('evidence-list', 'evidence-detail', 'profile-list', 'profile-detail')
_BOTTOM_BAR = [(0, x, 176, 'v') for x in range(0, 256, 16)]               # 下の帯（ふつう）
_RECORD_BOTTOM = ([(0, x, 160, 'v') for x in range(0, 64, 16)] + [(1, 64, 160, 'hv')]
                  + [(0, x, 174, 'v') for x in range(80, 256, 16)])       # 法廷記録の下の帯（もどるの後ろが高い）
_RECORD_TOP = [(0, 0, -22, '2'), (0, 32, -22, '2')] + [(0, x, -14, '2') for x in (80, 112, 144)]


def _scene(scene: str, items: list) -> list:
    return [(scene, *it) if len(it) == 4 else (scene, *it, '') for it in items]


PLACEMENTS: list[tuple[str, int, int, int, str]] = []
for _s in ('advance', 'idle', 'choice'):
    PLACEMENTS += _scene(_s, _BOTTOM_BAR + [(0, x, -14, '2') for x in range(0, 160, 32)] + [(9, 176, 0)])
PLACEMENTS += _scene('cross-exam', _BOTTOM_BAR + [(20, 0, 0), (19, 176, 0), (72, 80, 0)])
for _s in RECORD_SCENES + ('evidence-present',):
    title = 55 if _s.startswith('profile') else 56
    tab = [] if _s == 'evidence-present' else [(23 if _s.startswith('profile') else 11, 176, 0)]
    btn = [(18, 88, 0)] if _s == 'evidence-present' else []
    top = _RECORD_TOP[:2] if _s == 'evidence-present' else _RECORD_TOP   # つきつけるの画面は帯が左だけ
    PLACEMENTS += _scene(_s, _RECORD_BOTTOM + [(7, 0, 160)] + [(title, 0, 0), (65, 32, 0), (3, 64, 0)]
                         + top + tab + btn)
PLACEMENTS += _scene('episode-select', [(7, 0, 160), (28, 176, 160)])
