"""法廷記録の説明文・名前の画像（tbl_record.py が書き出したもの）を、1 字ずつの字形に切り分ける。small_font.py から使う。

説明文（128×64、record/desc/ja/NNN.png）:
  色番号 2 = 字（灰 57,57,57）、14 = 影（106,148,106）、15 = 地（156,197,148）。影は字をそのまま 1 点下にずらしたもの
  （字と重なるところは字）。一番上の行（y=0）の色番号 2 は枠の線なので字ではない。
  ふつうは 3 行で、字の帯（高さ 10）の上端が y = 4, 19, 34（行の送り 15）。字は x = 1 + 11i から始まる幅 11 のマス
  （送り 11）に入る。字の点は帯の 1 点上・下（y = 上端 - 1 〜 上端 + 10）まではみ出すことがある。
  一部（108〜115）は表の形で、行の位置も字の送りも違う → 行は点のある行のかたまりから、字は点のある列のかたまりから切る。
名前（128×16、record/name/ja/NNN.png）:
  色番号 2 = 字（橙 255,172,24）、1 = 地（57,57,57）。影は無い。字は y = 1〜14 に収まり、送り 14 で真ん中寄せ。
  マスの区切り（x = p + 14k）は画像ごとに、点の列のかたまりをまたがない位置を探して決める。
"""
import os
from dataclasses import dataclass, field

import numpy as np
from PIL import Image

# 説明文
DESC_INK, DESC_SHADOW, DESC_BG = 2, 14, 15
DESC_TOPS = (4, 19, 34)
DESC_PITCH = 11
DESC_X0 = 1          # マスの左端（x = 1 + 11i）
DESC_CELL_W = 11
DESC_CELL_H = 12     # 帯の上 1 点 + 10 + 下 1 点
DESC_TEXT_H = 47     # これより下（y >= 47）は窓の枠
# 名前
NAME_INK, NAME_BG = 2, 1
NAME_PITCH = 14
NAME_TOP = 1
NAME_CELL = 14


@dataclass
class Glyph:
    """切り出した 1 字。bits は字の点のある範囲だけに詰めたもの（位置によらない比較用）"""
    bits: np.ndarray
    dx: int | None   # マスの中での点の範囲の左端（マスが決まらない切り方のときは None）
    dy: int          # マスの中での点の範囲の上端
    x: int           # 画像の中での点の範囲の左上
    y: int

    @property
    def key(self) -> bytes:
        h, w = self.bits.shape
        return bytes([h, w]) + np.packbits(self.bits).tobytes()


@dataclass
class Line:
    """1 行ぶんの字の並び（None は空きマス＝空白）"""
    src: str          # record/desc/ja/NNN.png など
    kind: str         # 'desc' か 'name'
    index: int        # 行の番号（名前は 0）
    top: int          # マスの上端の y
    cells: list = field(default_factory=list)   # Glyph か None
    grid: bool = True  # 送りが決まった並びか


def crop(cell: np.ndarray) -> tuple[np.ndarray, int, int] | None:
    ys, xs = np.nonzero(cell)
    if len(ys) == 0:
        return None
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    return cell[y0:y1 + 1, x0:x1 + 1].copy(), int(x0), int(y0)


def col_runs(col: np.ndarray) -> list[tuple[int, int]]:
    """点のある列のかたまり（両端を含む）"""
    runs, x, n = [], 0, len(col)
    while x < n:
        if col[x]:
            s = x
            while x < n and col[x]:
                x += 1
            runs.append((s, x - 1))
        else:
            x += 1
    return runs


def free_cells(band: np.ndarray, top: int, max_w: int, max_gap: int) -> list:
    """送りが決まらない行を、点のある列のかたまりで字に分ける（近いかたまりは幅 max_w まで 1 字にまとめる）"""
    runs = col_runs(band.any(0))

    def paren(a: int, b: int) -> bool:
        """かっこ（細くて帯の高さいっぱい）は隣とまとめない"""
        ys = np.nonzero(band[:, a:b + 1].any(1))[0]
        return b - a < 4 and ys[-1] - ys[0] >= band.shape[0] - 2

    groups: list[list[int]] = []
    for a, b in runs:
        if (groups and a - groups[-1][1] - 1 <= max_gap and b - groups[-1][0] + 1 <= max_w
                and not paren(a, b) and not paren(*groups[-1])):
            groups[-1][1] = b
        else:
            groups.append([a, b])
    cells = []
    for a, b in groups:
        c = crop(band[:, a:b + 1])
        bits, x0, y0 = c
        cells.append(Glyph(bits, None, y0, a + x0, top + y0))
    return cells


def desc_bands(ink: np.ndarray) -> tuple[list[int], bool]:
    """字の帯の上端の一覧と、決まった位置（4, 19, 34）かどうか"""
    rows = ink.any(1)
    allowed = np.zeros(len(rows), bool)
    for t in DESC_TOPS:
        allowed[t - 1:t + 11] = True
    if not (rows & ~allowed).any():
        return list(DESC_TOPS), True
    return [a for a, b in col_runs(rows) if b - a >= 6], False


def grid_cells(band: np.ndarray, top: int, x0: int, pitch: int, n: int) -> list:
    """決まった送りのマスに分ける。区切りをまたぐ点の列のかたまりは、列の多い側のマスの字にする"""
    owner = np.full(band.shape[1], -1)
    for a, b in col_runs(band.any(0)):
        cols = np.arange(a, b + 1)
        idx = (cols - x0) // pitch
        owner[a:b + 1] = np.bincount(idx - idx.min()).argmax() + idx.min()
    cells = []
    for i in range(n):
        x = x0 + pitch * i
        sel = np.nonzero(owner == i)[0]
        if len(sel) == 0:
            cells.append(None)
            continue
        lo = int(sel.min())
        part = band[:, lo:int(sel.max()) + 1] & (owner[lo:int(sel.max()) + 1] == i)
        bits, cx, cy = crop(part)
        cells.append(Glyph(bits, lo + cx - x, cy, lo + cx, top + cy))
    return cells


def read_desc(root: str, rel: str) -> list[Line]:
    a = np.array(Image.open(os.path.join(root, rel)))
    ink = np.zeros(a.shape, bool)
    ink[2:DESC_TEXT_H] = a[2:DESC_TEXT_H] == DESC_INK
    tops, fixed = desc_bands(ink)
    lines = []
    for li, t in enumerate(tops):
        band = ink[t - 1:t - 1 + DESC_CELL_H]
        line = Line(rel, 'desc', li, t - 1)
        if not band.any():
            lines.append(line)
            continue
        if fixed:
            line.cells = grid_cells(band, t - 1, DESC_X0, DESC_PITCH, (128 - DESC_X0) // DESC_PITCH + 1)
        else:
            line.grid = False
            line.cells = free_cells(band, t - 1, DESC_CELL_W, 1)
        while line.cells and line.cells[-1] is None:
            line.cells.pop()
        lines.append(line)
    return lines


def name_phase(band: np.ndarray) -> tuple[int, int]:
    """名前のマスの区切り（x = p + 14k）の p と、区切りをまたぐかたまりの数"""
    runs = col_runs(band.any(0))
    best = None
    for p in range(NAME_PITCH):
        cross = sum(1 for a, b in runs if (a - p) // NAME_PITCH != (b - p) // NAME_PITCH)
        # またぎが同じなら、字の左端がマスの 1 点目に来るものが多い区切り
        starts = sum(1 for a, b in runs if (a - p) % NAME_PITCH == 1)
        cand = (cross, -starts, p)
        if best is None or cand < best:
            best = cand
    return best[2], best[0]


def read_name(root: str, rel: str) -> list[Line]:
    a = np.array(Image.open(os.path.join(root, rel)))
    band = (a == NAME_INK)[NAME_TOP:NAME_TOP + NAME_CELL]
    line = Line(rel, 'name', 0, NAME_TOP)
    if not band.any():
        return [line]
    p, cross = name_phase(band)
    if cross == 0:
        line.cells = grid_cells(band, NAME_TOP, p - NAME_PITCH, NAME_PITCH, 128 // NAME_PITCH + 2)
        while line.cells and line.cells[0] is None:
            line.cells.pop(0)
        while line.cells and line.cells[-1] is None:
            line.cells.pop()
    else:
        line.grid = False
        line.cells = free_cells(band, NAME_TOP, 13, 3)
    return [line]
