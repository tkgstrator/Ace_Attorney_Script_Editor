"""small_font.py の結果（字形と文字の対応）から、フォントの PNG・JSON・寸法・確認用の一覧・報告を書き出す。"""
import collections
import difflib
import json
import os
import unicodedata

import numpy as np
from PIL import Image, ImageDraw, ImageFont

from small_font_ocr import CONFIDENT, MIN_VOTES, norm
from small_font_seg import (DESC_PITCH, DESC_TOPS, DESC_X0, NAME_CELL, NAME_PITCH, NAME_TOP)

COLUMNS = 64
#: 種類ごと: (ファイル名, マスの大きさ, マスの左端 = 字のマスの左端から何点左か)
ATLAS = {'desc': ('ds-small-font', 12, 1), 'name': ('ds-small-name-font', NAME_CELL, 0),
         'profile': ('ds-small-profile-name-font', NAME_CELL, 0)}
#: 報告での呼び名
LABEL = {'desc': '説明文', 'name': '証拠品の名前', 'profile': '人物ファイルの名前'}
LABEL_FONT = '/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc'
#: 台本の表記ゆれ（charset.ALIASES と同じ考え方）
ALIASES = {'…': '‥', '―': 'ー', '—': 'ー', '〜': '～'}


def placement(ids: list[int], font: dict) -> dict[int, tuple[int, int]]:
    """字形ごとの、マスの中での位置 (dx, dy)（出てきた場所でいちばん多いもの。送りが決まらない行だけなら真ん中）"""
    lines, where, reps = font['lines'], font['where'], font['reps']
    out = {}
    for i in ids:
        c = collections.Counter((lines[li].cells[j].dx, lines[li].cells[j].dy) for li, j in where[i]
                                if lines[li].cells[j].dx is not None)
        if c:
            out[i] = c.most_common(1)[0][0]
        else:
            w = reps[i].bits.shape[1]
            pitch = DESC_PITCH if lines[0].kind == 'desc' else NAME_PITCH
            out[i] = ((pitch - 1 - w) // 2 + 1, reps[i].dy)
    return out


def chosen(font: dict) -> dict[str, int]:
    """文字 → 使う字形の番号（同じ文字に字形が複数あれば、出てくる数の多いもの）"""
    best: dict[str, int] = {}
    for i, d in enumerate(font['dec']):
        ch = d['char']
        if len(ch) != 1:
            continue
        if ch not in best or len(font['where'][i]) > len(font['where'][best[ch]]):
            best[ch] = i
    return best


def with_aliases(best: dict[str, int]) -> dict[str, int]:
    out = dict(best)
    for ch, i in best.items():
        if 0x21 <= ord(ch) <= 0x7E:
            out.setdefault(chr(ord(ch) + 0xFEE0), i)
        wide = unicodedata.normalize('NFKC', ch)
        if len(wide) == 1:
            out.setdefault(wide, i)
    for a, t in ALIASES.items():
        if t in out:
            out.setdefault(a, out[t])
    return out


def write_atlas(out_dir: str, kind: str, font: dict) -> dict[str, int]:
    name, size, left = ATLAS[kind]
    best = chosen(font)
    table = with_aliases(best)
    place = placement(sorted(set(table.values())), font)
    chars = sorted(table, key=ord)
    rows = -(-len(chars) // COLUMNS)
    img = np.zeros((rows * size, COLUMNS * size), np.uint8)
    for k, ch in enumerate(chars):
        i = table[ch]
        bits = font['reps'][i].bits
        dx, dy = place[i]
        ox, oy = (k % COLUMNS) * size + dx + left, (k // COLUMNS) * size + dy
        h, w = bits.shape
        x0, y0 = max(0, -(dx + left)), max(0, -dy)
        w1, h1 = min(w, size - dx - left), min(h, size - dy)
        img[oy + y0:oy + h1, ox + x0:ox + w1][bits[y0:h1, x0:w1]] = 255
    Image.fromarray(img).save(os.path.join(out_dir, name + '.png'))
    with open(os.path.join(out_dir, name + '.json'), 'w', encoding='utf-8') as f:
        f.write('{"size": %d, "columns": %d, "chars": %s}\n' % (size, COLUMNS, json.dumps(''.join(chars), ensure_ascii=False)))
    return best


def ink_stats(font: dict, kind: str) -> dict:
    """フォントのマスの中での字の点の範囲（全字形をまとめたもの・いちばん多い上端と下端）"""
    left = ATLAS[kind][2]
    place = placement(sorted(set(chosen(font).values())), font)
    tops, bots, x0s, x1s = collections.Counter(), collections.Counter(), [], []
    for i, (dx, dy) in place.items():
        h, w = font['reps'][i].bits.shape
        tops[dy] += 1
        bots[dy + h - 1] += 1
        x0s.append(dx + left)
        x1s.append(dx + left + w - 1)
    return {'ink_top': tops.most_common(1)[0][0], 'ink_bottom': bots.most_common(1)[0][0],
            'ink_box': [min(x0s), min(tops), max(x1s), max(bots)]}


def write_metrics(out_dir: str, fonts: dict) -> None:
    desc, name, profile = (ink_stats(fonts[k], k) for k in ('desc', 'name', 'profile'))
    m = {
        '_about': '法廷記録の小さい字（small_font.py）。座標は元の絵（説明文 128×64、名前 128×16）の点。name = 証拠品の名前、profile = 人物ファイルの名前（別のフォント）。'
                  'フォントのマスの (0,0) を (ペンの x - cell_origin_x, 行の上端 - cell_origin_y) に置いて描き、ペンを advance 進める。'
                  'ink_top / ink_bottom / ink_box はフォントのマスの中の座標（ink_box = [左, 上, 右, 下] は全字形をまとめた範囲）。'
                  '影は字の点を shadow.offset だけずらして、字の無いところに塗る。',
        'desc': {
            'atlas': 'ds-small-font', 'cell': 12, 'cell_origin_x': 1, 'cell_origin_y': 0,
            'pen_x0': DESC_X0, 'advance': DESC_PITCH, 'line_tops': [t - 1 for t in DESC_TOPS],
            'line_pitch': DESC_TOPS[1] - DESC_TOPS[0], 'lines': 3, 'max_chars_per_line': 11,
            **desc, 'glyph_h': 10,
            'note': 'ふつうの字は点が x = ペン+1〜ペン+9、y = 行の上端+1〜+10（元の絵では y = 4〜13, 19〜28, 34〜43）。'
                    '字によってはマスの左右・上下に 1 点はみ出す。108〜115 の表（年齢・性別）だけは行も字の位置も違う',
            'color': [57, 57, 57], 'background': [156, 197, 148],
            'shadow': {'offset': [0, 1], 'color': [106, 148, 106]},
            'frame': {'y0': [57, 57, 57], 'y1': [106, 148, 106], 'y47': [205, 205, 205], 'y48': [238, 238, 238],
                      'y49': [131, 131, 131], 'below': [0, 255, 0], 'note': 'y=0〜1 と y=47〜49 の横線は窓の枠。y>=50 は透明色（緑）'},
        },
        'name': {
            'atlas': 'ds-small-name-font', 'cell': NAME_CELL, 'cell_origin_x': 0, 'cell_origin_y': 0,
            'advance': NAME_PITCH, 'line_top': NAME_TOP, **name, 'glyph_h': 12,
            'align': '字の点の範囲（左端の字の点〜右端の字の点）の真ん中を x = 63.5 に置く（ずれは ±1 点）',
            'layout': '全角の字を送り 14 で並べる（2〜9 字。字と字の間の全角の空白も 1 マス。「写　真」「金　庫」）。'
                      '10 字の名前（九太のデジタルカメラ・多田敷道夫の解剖記録）は送りを 12〜13 に詰めて x = 0〜127 に収める。'
                      '英数字（DL6・SL9・ID：・5年前・2年前）は字の幅が狭く、送りは 10〜16 とまちまち（決まった規則は見つからない）。'
                      'かっこは「荷星（？）の写真」だけで、かっこも 1 マス',
            'color': [255, 172, 24], 'background': [57, 57, 57], 'shadow': None,
            'examples': {'高日美佳の解剖記録': [2, 17, 30, 44, 58, 72, 86, 100, 114], '写　真': [44, 73], '置物': [45, 70],
                         '九太のデジタルカメラ': [1, 14, 28, 42, 56, 68, 79, 92, 104, 116],
                         'DL6号事件の弾丸': [3, 19, 32, 44, 58, 72, 86, 100, 114], 'ID：多田敷道夫': [7, 17, 35, 44, 58, 72, 95, 109],
                         '_about': '各字の点の左端の x（元の絵の座標）'},
        },
        'profile': {
            'atlas': 'ds-small-profile-name-font', 'cell': NAME_CELL, 'cell_origin_x': 0, 'cell_origin_y': 0,
            'advance': NAME_PITCH, 'line_top': NAME_TOP, **profile, 'glyph_h': 12,
            'align': '証拠品の名前と同じく、字の点の範囲の真ん中を x = 63.5 に置く',
            'layout': '「姓　名（年齢）」を全マス送り 14 で並べる（姓と名の間は全角の空白 1 マス、年齢は 1〜2 桁の数字 / ？？ / 故人）。'
                      '「（」はマスの右寄り（マスの 10〜12 点目）、「）」はマスの左寄り、数字はマスの中ほど。'
                      '例: 綾里　千尋（27）= 9 マス、点は x = 7〜120。'
                      'マスが 10 以上になる名前（星影宇宙ノ介・大沢木ナツミ・市ノ谷響華・原灰ススム・多田敷道夫の年齢付き）は詰めてある: '
                      '名前は送り 14 のまま姓と名の間だけ 5〜6 点空け、年齢は「（」の 5〜6 点右に 1 桁目、2 桁目は送り 9〜14、'
                      '「）」は最後の数字のすぐ右（字の左端の x の例は examples）。'
                      '年齢の無い人物名（114〜121、表からは使われない）は姓　名のみ',
            'color': [255, 172, 24], 'background': [57, 57, 57], 'shadow': None,
            'note': '証拠品の名前とは別に描かれた字形で、同じ文字でも点の並びが違うものが多い',
            'examples': {'綾里　千尋（27）': [7, 21, 49, 63, 87, 93, 106, 118], '小中　大（39）': [14, 28, 56, 80, 86, 100, 111],
                         '星影宇宙ノ介（64）': [3, 17, 36, 50, 65, 78, 97, 102, 111, 122],
                         '大沢木ナツミ（22）': [3, 17, 31, 50, 65, 79, 97, 102, 112, 122],
                         '多田敷道夫（36）': [3, 18, 32, 51, 65, 89, 95, 109, 120], '宝月　茜': [37, 51, 79],
                         '_about': '各字の点の左端の x（元の絵の座標）'},
        },
    }
    with open(os.path.join(out_dir, 'ds-small-font.metrics.json'), 'w', encoding='utf-8') as f:
        json.dump(m, f, ensure_ascii=False, indent=2)
        f.write('\n')


def write_shapes(work: str, fonts: dict, best: dict[str, dict[str, int]]) -> None:
    """全字形（点の並び）と当てた文字の一覧 small/glyphs.json。record_text.py が画像の字を完全一致で引くのに使う。
    {種類: [{"key": 字形の鍵（16 進）, "char": 文字, "count": 出てくる数, "primary": フォントに入れた字形か,
             "fixed": small_font_fixes.tsv で目で見て決めた（確かめた）字形か}]}"""
    out = {}
    for kind, f in fonts.items():
        out[kind] = [{'key': rep.key.hex(), 'char': d['char'], 'count': len(f['where'][i]),
                      'primary': best[kind].get(d['char']) == i, 'fixed': d['fixed']}
                     for i, (rep, d) in enumerate(zip(f['reps'], f['dec']))]
    with open(os.path.join(work, 'glyphs.json'), 'w', encoding='utf-8') as fp:
        json.dump(out, fp, ensure_ascii=False, indent=0)
        fp.write('\n')


def low(d: dict) -> bool:
    return not d['fixed'] and (d['total'] < MIN_VOTES or d['ratio'] < CONFIDENT or len(d['char']) != 1)


def decode(font: dict, li: int, key: str = 'dec') -> str:
    return ''.join(font[key][i]['char'] if i is not None else '　' for i in font['seqs'][li]).rstrip('　')


def write_review(work: str, fonts: dict) -> None:
    """種類ごとに review_<種類>.png（全字形と当てた文字の一覧）"""
    lab = ImageFont.truetype(LABEL_FONT, 26)
    small = ImageFont.truetype(LABEL_FONT, 11)
    tile_w, tile_h, per_row, scale = 104, 70, 16, 4
    for kind, f in fonts.items():
        n = len(f['reps'])
        sheet = Image.new('RGB', (per_row * tile_w, -(-n // per_row) * tile_h), (255, 255, 255))
        draw = ImageDraw.Draw(sheet)
        for i in range(n):
            d = f['dec'][i]
            x, y = (i % per_row) * tile_w, (i // per_row) * tile_h
            bg = (200, 225, 255) if d['fixed'] else ((255, 200, 200) if low(d) else (240, 240, 240))
            draw.rectangle([x + 1, y + 1, x + tile_w - 2, y + tile_h - 2], fill=bg)
            bits = f['reps'][i].bits
            g = Image.fromarray(np.where(bits, 0, 255).astype(np.uint8)).resize((bits.shape[1] * scale, bits.shape[0] * scale), Image.NEAREST)
            sheet.paste(g, (x + 3, y + 3))
            draw.text((x + 62, y + 4), d['char'] or '?', font=lab, fill=(200, 0, 0))
            draw.text((x + 3, y + 57), f"{i} ×{len(f['where'][i])} {d['votes']}/{d['total']}", font=small, fill=(0, 0, 0))
        sheet.save(os.path.join(work, f'review_{kind}.png'))

    rows_out = ['# 種類\t字形の番号\t文字\t票/読めた数\tほかの候補\t出てくる場所（small_font_fixes.tsv の鍵）\tその行を今の対応で読んだもの\t文字認識の結果']
    for kind, f in fonts.items():
        for i, d in enumerate(f['dec']):
            if low(d):
                li, j = f['where'][i][0]
                ln = f['lines'][li]
                rows_out.append(f"{kind}\t{i}\t{d['char']}\t{d['votes']}/{d['total']}\t{d['others']}\t{ln.src}:{ln.index}:{j}"
                                f"\t{decode(f, li)}\t{' | '.join(f['texts'][li][:2])}")
    with open(os.path.join(work, 'review.tsv'), 'w', encoding='utf-8') as fp:
        fp.write('\n'.join(rows_out) + '\n')


def accuracy(fonts: dict, truth: dict[str, str], which: str = 'dec') -> tuple[int, int, list[str]]:
    ok = total = 0
    diffs = []
    for f in fonts.values():
        for li, ln in enumerate(f['lines']):
            key = f'{ln.src}:{ln.index}'
            if key not in truth:
                continue
            want = ''.join(norm(c) for c in truth[key])
            got = decode(f, li, which).replace('　', '')
            sm = difflib.SequenceMatcher(None, want, got, autojunk=False)
            ok += sum(b.size for b in sm.get_matching_blocks())
            total += len(want)
            if want != got:
                diffs.append(f'{key}\t正: {want}\t今: {got}')
    return ok, total, diffs


def write_all(root: str, out_dir: str, work: str, fonts: dict, truth: dict, script: collections.Counter) -> None:
    os.makedirs(work, exist_ok=True)
    best = {kind: write_atlas(out_dir, kind, f) for kind, f in fonts.items()}
    write_metrics(out_dir, fonts)
    write_review(work, fonts)
    write_shapes(work, fonts, best)
    with open(os.path.join(work, 'decoded.tsv'), 'w', encoding='utf-8') as fp:
        for kind, f in fonts.items():
            for li, ln in enumerate(f['lines']):
                fp.write(f'{ln.src}:{ln.index}\t{decode(f, li)}\n')

    from small_font_check import check_desc, same_shape_rate
    rep = []
    n, same, bad, px = check_desc(root, out_dir, fonts['desc'])
    rep.append(f'書き出したフォントで説明文 {n} 枚を描き直した結果: 元と点まで同じ {same} 枚、違う点 {bad}/{px}（{bad / px:.3%}）')
    for kind, f in fonts.items():
        ok, total = same_shape_rate(f)
        rep.append(f'[{kind}] 字の出てくる {total} か所のうち、フォントの字形と点の並びまで同じもの {ok}（{ok / total:.1%}）')
    ok, total, diffs = accuracy(fonts, truth, 'raw')
    rep.append(f'第 1 話の正解（text_ja）との一致（文字認識だけ、手直し前）: {ok}/{total} 字（{ok / max(total, 1):.1%}）')
    rep += ['  ' + d for d in diffs]
    ok, total, diffs = accuracy(fonts, truth)
    rep.append(f'第 1 話の正解（text_ja）との一致（small_font_fixes.tsv で手直し後）: {ok}/{total} 字（{ok / max(total, 1):.1%}）')
    rep += ['  ' + d for d in diffs]
    all_chars = set(script)
    n_all = sum(script.values())
    for kind, f in fonts.items():
        ch = [i for i, (a, b) in enumerate(zip(f['raw'], f['dec'])) if a['char'] != b['char']]
        occ = sum(len(f['where'][i]) for i in ch)
        rep.append(f"[{kind}] 文字認識の結果を手で直した字形 {len(ch)}/{len(f['dec'])}（出てくる場所では {occ}/{sum(len(w) for w in f['where'].values())}）")
    shared = set(best['name']) & set(best['profile'])
    same = sum(1 for c in shared if fonts['name']['reps'][best['name'][c]].key == fonts['profile']['reps'][best['profile'][c]].key)
    rep.append(f'証拠品と人物ファイルの名前の両方にある {len(shared)} 字のうち、フォントに入れた字形の点の並びが同じもの {same} 字')
    union = set(best['desc']) | set(best['name']) | set(best['profile'])
    cov = all_chars & union
    rep.append(f'説明文と名前（証拠品・人物）の字を合わせると {len(union)} 字、台本の文字 {len(all_chars)} 字のうち {len(cov)} 字'
               f'（出てくる回数では {sum(script[c] for c in cov) / n_all:.1%}）')
    for kind, f in fonts.items():
        b = best[kind]
        dup = [ch for ch in b if sum(1 for d in f['dec'] if d['char'] == ch) > 1]
        lows = sum(1 for d in f['dec'] if low(d))
        have = set(b)
        cov = all_chars & have
        occ = sum(script[c] for c in cov)
        rep.append(f"\n[{kind}]（{LABEL[kind]}、{ATLAS[kind][0]}）字形 {len(f['reps'])} 種類 → 文字 {len(b)} 字（同じ文字に字形が複数: {''.join(sorted(dup))}）、要確認 {lows}")
        rep.append(f'  台本（日本語）の文字 {len(all_chars)} 字のうち {len(cov)} 字（{len(cov) / len(all_chars):.1%}）、'
                   f'出てくる回数では {occ}/{n_all}（{occ / n_all:.1%}）')
        missing = sorted(all_chars - have, key=lambda c: -script[c])
        rep.append(f'  足りない字（台本に多い順、{len(missing)} 字）: ' + ''.join(missing))
        rep.append(f"  台本に無い字: {''.join(sorted(have - all_chars, key=ord))}")
        rep.append(f"  台本とほとんど一致した行と、台本の字（{len(f['lex'])}。名前は票を足した、説明文は参考）:")
        rep += ['    ' + x for x in f['lex']]
    with open(os.path.join(work, 'report.txt'), 'w', encoding='utf-8') as fp:
        fp.write('\n'.join(rep) + '\n')
    print('\n'.join(r if len(r) < 300 else r[:300] + '…' for r in rep[:3] + rep[-8:]))
