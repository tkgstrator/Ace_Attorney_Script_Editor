# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy", "pillow>=10"]
# ///
"""法廷記録の項目番号 → 名前・説明文（tables/record_text.json）の対応を、絵とは別の手がかりで確かめる。

    uv run tools/rom/record_text_verify.py [record_text.json]

record_text_check.py は「読んだ字が絵と同じか」を確かめるが、「その絵がその項目のものか」は確かめない。
ここでは項目番号と名前の対応を、次の手がかりと突き合わせる（全部の項目。矛盾が 0 なら終了コード 0）。
  1. 台本: 法廷記録に加える命令（23 record_add・25 record_swap の新しい項目）の後の「《○○》…ファイルした」の ○○ と名前。
     続けて加える命令は 1 組として、文の《○○》が組のどれかの名前と合えばよい。台本での呼び方が名前の一部だけのもの
     （「解剖記録」→「多田敷道夫の解剖記録」など）は、名前の頭か終わりと合えばよい。呼び方がまったく違うものは ALIAS。
  2. 3D の物の表（tables/examine3d.json）: 証拠品の model3d − 1 の物のテクスチャの名前 itmXXY の XX（16 進）は
     アイコンの番号。XX がその項目のアイコンか、アイコン XX の法廷記録に入る項目と名前が同じなら合う。
     アイコン XX の項目が法廷記録に入らなければ手がかり無し（数だけ出す）。
  3. 空き欄: 表の欄が空き（evidence.json の blank。tbl_record.blank_fields）の項目は、法廷記録に入らない
     （話の最初の中身・台本の record_add / record_swap に出ない）。法廷記録に入る項目には名前と説明文の絵がある。
     欄が空きなら、その欄の文字も空（record_text.json に文字があれば矛盾）。
  4. 名前の字の種類: 人物ファイルとして入る項目の名前は人物ファイルの字（年齢の付く形）、証拠品として入る項目は証拠品の字。
  5. 同じ説明文（空でないもの）の項目どうしは、同じ名前。
  6. 同じ名前と説明文の項目どうしは、同じアイコン（別の物に同じ文が付いていない）。
     5・6 は、分かれた組に法廷記録に入らない項目があるときに矛盾とする（入る項目どうしは同じ文の別の物。shared_text）。
     古い読み方（空き欄を項目 0 の絵と読んだもの）では、第 5 話の 171〜204 の 32 項目が千尋さんの文になって、ここで出る。
  7. 名前の年齢「（NN）」と説明文の「年齢：NN才」。
出力: font/small/record_verify.txt（矛盾の一覧と、確かめた数）
"""
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from record_glyphs import X, record_lines  # noqa: E402

#: 台本での呼び方 → 項目の名前（呼び方が名前の頭・終わりのどちらでもないもの）
ALIAS = {'多田敷捜査官のID': 'ID：多田敷道夫'}
OP = re.compile(r'\[record_(add|swap) (?:(evidence|profile) )?(\d+)(?: (\d+))?[^\]]*\]')
TAG = re.compile(r'\[[^\]]*\]')
PROFILE_BIT, NUM_MASK = 0x8000, 0x3fff


def bare(s: str) -> str:
    return re.sub(r'\s', '', s)


def called(word: str, name: str) -> bool:
    """台本の呼び方 word が項目の名前 name を指すか"""
    w, n = bare(ALIAS.get(word, word)), bare(name)
    return bool(w) and bool(n) and (w == n or n.startswith(w) or n.endswith(w))


def script_ops(x_dir: str) -> list[tuple[str, list[tuple[int, str]], str]]:
    """台本（日本語 = 偶数番）の法廷記録に加える命令の組: (項目, [(番号, 'evidence' / 'profile')], 後の文)"""
    out = []
    for path in sorted(glob.glob(os.path.join(x_dir, 'script', '*.txt'))):
        entry = os.path.basename(path)[:-4]
        if not entry.isdigit() or int(entry) % 2:
            continue
        s = open(path, encoding='utf-8').read()
        ops = list(OP.finditer(s))
        k = 0
        while k < len(ops):
            run = [ops[k]]
            while k + 1 < len(ops) and not TAG.sub('', s[run[-1].end():ops[k + 1].start()]).strip():
                k += 1
                run.append(ops[k])
            k += 1
            nxt = ops[k].start() if k < len(ops) else len(s)
            end = s.find('[end]', run[-1].end())
            text = TAG.sub('', s[run[-1].end():min(nxt, end if end >= 0 else len(s))])
            ids = []
            for m in run:
                if m.group(1) == 'add':
                    ids.append((int(m.group(3)) & NUM_MASK, m.group(2) or 'evidence'))
                else:
                    # 人物ファイルかどうかは旧・新どちらかの bit15（record_swap 32768 10 = 人物ファイル 0 → 10）
                    old, new = int(m.group(3)), int(m.group(4))
                    ids.append((new & NUM_MASK, 'profile' if (old | new) & PROFILE_BIT else 'evidence'))
            out.append((entry, ids, text))
    return out


def check_script(ops, names: dict[int, str]) -> tuple[int, list[str]]:
    ok, bad = 0, []
    for entry, ids, text in ops:
        k = text.find('ファイル')
        words = re.findall(r'《([^》]*)》', text[:k]) if k >= 0 else []
        if not words:
            continue
        word = words[-1]
        if any(called(word, names.get(i, '')) for i, _ in ids):
            ok += 1
        else:
            got = ', '.join(f'{i}={names.get(i, "")!r}' for i, _ in ids)
            bad.append(f'台本\t{entry}\t《{word}》をファイルした\t{got}')
    return ok, bad


def check_3d(ev: list[dict], names: dict[int, str], into: dict, x_dir: str) -> tuple[int, list[str]]:
    path = os.path.join(x_dir, 'tables', 'examine3d.json')
    if not os.path.exists(path):
        return 0, ['3D\ttables/examine3d.json が無い（uv run tools/rom/tbl_examine3d.py）']
    objects = json.load(open(path, encoding='utf-8'))['objects']
    by_icon: dict[int, set[str]] = {}
    for it in ev:
        if names.get(it['id']) and it['id'] in into:
            by_icon.setdefault(it['icon'], set()).add(bare(names[it['id']]))
    ok, bad, unsure = 0, [], []
    for it in ev:
        m = it.get('model3d') or 0
        if not m or m - 1 >= len(objects) or not objects[m - 1]['textures']:
            continue
        tex = objects[m - 1]['textures'][0]
        icon = int(tex[3:6], 16)
        name = bare(names.get(it['id'], ''))
        if icon == it['icon'] or (name and name in by_icon.get(icon, set())):
            ok += 1
        elif icon not in by_icon:
            unsure.append(it['id'])
        else:
            bad.append(f'3D\t{it["id"]}\t物 {m - 1} のテクスチャ {tex}（アイコン {icon}）\t'
                       f'アイコン {it["icon"]}・名前 {names.get(it["id"], "")!r}（アイコン {icon} の名前 {sorted(by_icon.get(icon, []))}）')
    print(f'3D: テクスチャのアイコンの項目が法廷記録に入らず手がかり無し {unsure}')
    return ok, bad


def filed(ev_doc: dict, ops) -> dict[int, set[str]]:
    """法廷記録に入る項目 → 入れ方（evidence / profile）"""
    out: dict[int, set[str]] = {}
    for s in ev_doc['start']:
        for i in s['profiles']:
            out.setdefault(i, set()).add('profile')
        for i in s['evidence']:
            out.setdefault(i, set()).add('evidence')
    for _e, ids, _t in ops:
        for i, kind in ids:
            out.setdefault(i, set()).add(kind)
    return out


def check_blank(ev: list[dict], into: dict[int, set[str]], texts: dict[str, dict]) -> tuple[int, list[str]]:
    ok, bad = 0, []
    for it in ev:
        blank = [b for b in it.get('blank', []) if b != 'name_en']
        t = texts.get(str(it['id']), {})
        filled = [f for f, b in (('name', 'name_ja'), ('desc', 'desc')) if b in blank and t.get(f)]
        if it['id'] in into and blank:
            bad.append(f'空き欄\t{it["id"]}\t法廷記録に入るのに欄が空き（{blank}）')
        elif filled:
            bad.append(f'空き欄\t{it["id"]}\t欄が空き（{blank}）なのに文字がある（{filled}: {[t[f][:12] for f in filled]}）')
        elif it['id'] in into or blank:
            ok += 1
    return ok, bad


def check_age(ev: list[dict], texts: dict[str, dict]) -> tuple[int, list[str]]:
    """名前の年齢「（NN）」と、説明文の「年齢：NN才」（108〜115 の表の形の説明文）"""
    ok, bad = 0, []
    for it in ev:
        t = texts.get(str(it['id']), {})
        m = re.search(r'年齢：(\d+)才', t.get('desc', ''))
        if not m:
            continue
        n = re.search(r'（(\d+)）', t.get('name', ''))
        if n and n.group(1) != m.group(1):
            bad.append(f'年齢\t{it["id"]}\t名前 {t["name"]!r} と説明文の年齢 {m.group(1)} が違う')
        else:
            ok += 1
    return ok, bad


def check_kind(ev: list[dict], into: dict[int, set[str]], x_dir: str) -> tuple[int, list[str]]:
    lines = record_lines(x_dir)
    ok, bad = 0, []
    for it in ev:
        src = it['image']['name']['ja']
        kinds = into.get(it['id'], set())
        if not src or not kinds or not lines.get(src):
            continue
        font = lines[src][0].kind
        want = {'profile' if k == 'profile' else 'name' for k in kinds}
        if want == {font}:
            ok += 1
        else:
            bad.append(f'字の種類\t{it["id"]}\t{src} は {font} の字、入れ方は {sorted(kinds)}')
    return ok, bad


#: ROM の説明文の絵に「ダミー」とだけ書いた、使われない項目の仮の文（41・70・107）
DUMMY = 'ダミー'


def shared_text(ev: list[dict], texts: dict[str, dict], into: dict, key, part) -> tuple[int, list[str]]:
    """key（文）が同じ項目を part（名前・アイコン）で分け、分かれた組に法廷記録に入らない項目があれば矛盾。
    入る項目どうしで分かれるのは、同じ文の別の物（2 通の依頼状・2 枚の湖の写真・アイコンを差し替えた多田敷のメモ）"""
    groups: dict[str, dict] = {}
    for it in ev:
        t = texts.get(str(it['id']), {})
        k = key(t)
        if k and bare(t.get('desc', '')) != DUMMY:
            groups.setdefault(k, {}).setdefault(part(it, t), []).append(it['id'])
    bad = []
    for k, parts in sorted(groups.items()):
        ids = [i for v in parts.values() for i in v]
        if len(parts) > 1 and any(i not in into for i in ids):
            bad.append(f'同じ文\t{k[:16]}…\t分かれ方 {parts}（法廷記録に入らない項目 {[i for i in ids if i not in into]}）')
    return len(groups) - len(bad), bad


def check_pairs(ev: list[dict], texts: dict[str, dict], into: dict) -> tuple[int, list[str]]:
    return shared_text(ev, texts, into, lambda t: bare(t.get('desc', '')), lambda _it, t: t.get('name', ''))


def check_icons(ev: list[dict], texts: dict[str, dict], into: dict) -> tuple[int, list[str]]:
    return shared_text(ev, texts, into, lambda t: t.get('name') and t.get('desc') and bare(t['name'] + '／' + t['desc']),
                       lambda it, _t: it['icon'])


def main() -> None:
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(X, 'tables', 'record_text.json')
    texts = json.load(open(path, encoding='utf-8'))['items']
    ev_doc = json.load(open(os.path.join(X, 'tables', 'evidence.json'), encoding='utf-8'))
    ev = ev_doc['items']
    names = {it['id']: texts.get(str(it['id']), {}).get('name', '') for it in ev}
    ops = script_ops(X)
    into = filed(ev_doc, ops)
    results = [('台本の「ファイルした」', check_script(ops, names)), ('3D の物のテクスチャ', check_3d(ev, names, into, X)),
               ('空き欄と法廷記録', check_blank(ev, into, texts)), ('年齢', check_age(ev, texts)), ('名前の字の種類', check_kind(ev, into, X)),
               ('同じ説明文の名前', check_pairs(ev, texts, into)), ('同じ文のアイコン', check_icons(ev, texts, into))]
    head = [f'項目 {len(ev)}（法廷記録に入る {len(into)}・名前の無い {sum(1 for n in names.values() if not n)}）']
    report = []
    for title, (ok, bad) in results:
        head.append(f'{title}: 合う {ok}・矛盾 {len(bad)}')
        report += bad
    out = os.path.join(X, 'font', 'small', 'record_verify.txt')
    with open(out, 'w', encoding='utf-8') as f:
        f.write('\n'.join(head + ['# 手がかり\t項目\t内容'] + report) + '\n')
    print('\n'.join(head + report[:40]))
    print(f'→ {out}')
    sys.exit(1 if report else 0)


if __name__ == '__main__':
    main()
