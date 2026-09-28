"""data.bin のうち、先頭の画像アーカイブより後ろの領域の書き出し。

この領域には目次が無いので、databin.walk() で先頭から「パック・テクスチャ・圧縮データ」として
読める所を拾い、中身の大きさや見出しから形式を推定して書き出す。ARM9 の中の表から
背景の番号（bg_table）とリソース名（named_resources）が分かるものは、ファイル名に付ける。

書き出し先（out = data/tail）:
    bg/       背景（パレット + 帯のパック、または単独の背景）
    tex/      テクスチャ（3D で描く UI の部品など。名前が分かるものは名前付き）
    chars/<位置>/NNN/  キャラクターのアニメーション（コマの PNG、anim.gif、anim.tsv）。形式は ex_chars.py
    packs/<位置>/  その他のパックの中身（画像にできたものは .png、それ以外は .bin）
    blobs/    単独の圧縮データ（画像にできたものは .png、それ以外は .bin）
    index.tsv 拾ったものの一覧、unknown.tsv どれにも当てはまらなかった領域の一覧
"""
from pathlib import Path

import ex_chars
import gfx
import tailfmt
from databin import ARCHIVE_COUNT, bg_table, gaps, named_resources, walk
from nitro import COMPRESSION_TYPES, decompress

MIN_BLOB = 64          # これより小さい単独の圧縮データは誤検出が多いので書き出さない


def _unpack(d: bytes, p: int, size: int) -> tuple[bytes, str]:
    """パックの中身を 1 個取り出す（圧縮されていれば展開する）"""
    if d[p] in COMPRESSION_TYPES:
        try:
            out, used = decompress(d, p)
            if used <= size + 3:
                return out, f'lz{d[p]:02x}'
        except (IndexError, KeyError):
            pass
    return d[p:p + size], 'raw'


class Writer:
    def __init__(self, out: Path, raw: bool):
        self.out, self.raw = out, raw
        self.index: list[str] = []
        self.pngs: dict[str, list[Path]] = {}

    def image(self, group: str, stem: str, fn, *args) -> bool:
        path = self.out / group / f'{stem}.png'
        path.parent.mkdir(parents=True, exist_ok=True)
        if fn(*args, path):
            self.pngs.setdefault(group, []).append(path)
            return True
        return False

    def binary(self, group: str, stem: str, b: bytes) -> None:
        path = self.out / group / f'{stem}.bin'
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b)

    def log(self, offset: int, kind: str, size: int, note: str, dest: str) -> None:
        self.index.append(f'{offset:#09x}\t{kind}\t{size}\t{note}\t{dest}')


def _stem(off: int, names: dict, bgs: dict | None = None) -> str:
    s = f'{off:07x}'
    if bgs is not None and off in bgs:
        s = f'bg{bgs[off]:03}_{s}'
    if off in names:
        s += f'_{names[off]}'
    return s


def _pack(w: Writer, d: bytes, it, names: dict, bgs: dict) -> None:
    ents = it.info
    parts = [_unpack(d, p, s) for p, s in ents]
    data = [b for b, _ in parts]
    stem = _stem(it.offset, names, bgs)
    # 背景のパック（先頭がパレット、残りが圧縮された帯）
    if parts[0][1] == 'raw' and all(k != 'raw' for _, k in parts[1:]) and w.image('bg', stem, tailfmt.bg_pack, data):
        w.log(it.offset, 'pack/bg', it.size, f'{len(ents)} 個', f'bg/{stem}.png')
        return
    if tailfmt.is_char_pack(data):
        group = f'chars/{stem}'
        firsts = ex_chars.export_pack(data, w.out / group)
        w.pngs[group] = firsts
        if w.raw:
            for i, b in enumerate(data):
                w.binary(f'{group}/raw', f'{i // 2:03}_{"gfx" if i % 2 == 0 else "anim"}', b)
        w.log(it.offset, 'pack/chars', it.size, f'アニメーション {len(data) // 2} 個', group + '/')
        return
    group = f'packs/{stem}'
    made = 0
    for i, (b, kind) in enumerate(parts):
        name = f'{i:04}'
        ok = (w.image(group, name, tailfmt.texture, b) or w.image(group, name, tailfmt.profile_text, b)
              or w.image(group, name, tailfmt.name_label, b) or w.image(group, name, tailfmt.full_bg, b))
        made += ok
        if not ok or w.raw:
            w.binary(group, name, b)
    w.log(it.offset, 'pack', it.size, f'{len(ents)} 個、画像 {made} 枚', group + '/')


def export(d: bytes, arm9: bytes, out: Path, raw: bool = True, sheets: bool = True) -> None:
    out.mkdir(parents=True, exist_ok=True)
    items = walk(d)
    packs = [it for it in items if it.kind == 'pack']
    start = packs[ARCHIVE_COUNT - 1].offset + packs[ARCHIVE_COUNT - 1].size   # 先頭のアーカイブの後ろ
    items = [it for it in items if it.offset >= start]
    names = named_resources(arm9, len(d))
    bgs = bg_table(arm9, {it.offset for it in items if it.kind == 'pack'})
    w = Writer(out, raw)
    seen: set[bytes] = set()
    for it in items:
        if it.kind == 'pack':
            _pack(w, d, it, names, bgs)
        elif it.kind == 'tex':
            stem = _stem(it.offset, names)
            w.image('tex', stem, tailfmt.texture, d[it.offset:it.offset + it.size])
            t = it.info
            w.log(it.offset, 'tex', it.size, f'形式 {t.fmt} {t.w}×{t.h}', f'tex/{stem}.png')
        else:
            b, _ = decompress(d, it.offset)
            if len(b) < MIN_BLOB or not any(b) or b in seen:
                w.log(it.offset, 'blob', it.size, f'展開後 {len(b)}（小さい・空・重複のため省略）', '')
                continue
            seen.add(b)
            stem = _stem(it.offset, names)
            ok = (w.image('blobs', stem, tailfmt.texture, b) or w.image('bg', stem, tailfmt.full_bg, b)
                  or w.image('blobs', stem, tailfmt.gray_bitmap, b))
            if not ok or raw:
                w.binary('blobs', stem, b)
            w.log(it.offset, f'blob/lz{d[it.offset]:02x}', it.size, f'展開後 {len(b)}', 'png' if ok else 'bin')
    (out / 'index.tsv').write_text('位置\t種類\t大きさ\tメモ\t書き出し先\n' + '\n'.join(w.index) + '\n')
    unknown = [g for g in gaps(items, len(d)) if g[0] >= start]
    rows = [f'{o:#09x}\t{s}\t{names.get(o, "")}' for o, s in unknown]
    (out / 'unknown.tsv').write_text('位置\t大きさ\t名前\n' + '\n'.join(rows) + '\n')
    total = sum(s for _, s in unknown)
    print(f'  拾ったもの {len(items)} 個、未解明の領域 {len(unknown)} 個（計 {total / 1e6:.1f} MB）')
    _named_in_gaps(d, names, unknown, out / 'named')
    for group, paths in sorted(w.pngs.items()):
        print(f'  {group}: 画像 {len(paths)} 枚')
        if sheets:
            labels = [p.parent.name for p in paths] if group.startswith('chars') else None
            gfx.contact_sheet(paths, out / group / '_sheet.png', cols=12, cell=128, labels=labels)


def _named_in_gaps(d: bytes, names: dict, unknown: list, out: Path) -> None:
    """未解明の領域の中にあって ARM9 に名前が載っているもの（itm*** など）を、次の名前か領域の終わりまで書き出す"""
    n = 0
    for start, size in unknown:
        offs = sorted(o for o in names if start <= o < start + size)
        for o, nxt in zip(offs, offs[1:] + [start + size]):
            out.mkdir(parents=True, exist_ok=True)
            (out / f'{o:07x}_{names[o]}.bin').write_bytes(d[o:nxt])
            n += 1
    if n:
        print(f'  named: 名前付きの未解明データ {n} 個')
