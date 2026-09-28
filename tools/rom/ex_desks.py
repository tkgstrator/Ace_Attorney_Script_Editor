# /// script
# requires-python = ">=3.11"
# dependencies = ["numpy"]
# ///
"""法廷の机（弁護側・検察側・証言台）の書き出し。

    uv run tools/rom/ex_desks.py <rom.nds> [出力先（既定: assets/extracted/data/desks）]

机は背景（BG）ではなく OBJ（スプライト）で、人物より手前に描かれる。
data.bin の 0x1a7ffb4〜0x1ab13d4 は圧縮されていない生のタイル・パレットが並ぶ領域（目次は無く、
ARM9 のコードが data.bin の中の位置を直接持っている）で、机のタイルとパレットもここにある。

ARM9 のコード（0x0201e558 から、背景の番号ごとに呼び分けている）から読み取った内容:
    背景 3（弁護側）: 0x0202cd0c でタイルを読み込み、0x0202cbe0(x=0, y=0x90) で OAM を書く
    背景 4（検察側）: 同じタイルを 0x0202caa8(x=0x30, y=0x90) で左右反転して書く
    背景 5（証言台）: 0x0202cee8 でタイルを読み込み、0x0202cd9c(x=0x20, y=0x90) で書く（y は +8 される）
    読み込み（0x02019878(data.bin の位置, VRAM の位置, 大きさ, 種類)）:
        タイル → OBJ の VRAM 0xe700（1D マッピング・128 バイト単位なので OAM のタイル番号 0x1ce）
        パレット 32 バイト → OBJ のパレット 4 番
    OAM の属性 2 は 0x4dce + 0x10 × n（タイル 0x1ce + 64 × n 枚目、優先度 3、パレット 4）

OBJ のタイルは 1D マッピング（1 個の OBJ の中で、横 幅/8 枚 × 縦 高さ/8 行が続けて並ぶ）。
色番号 0 は透明。裁判長の机は背景（bg008）そのものに描かれていて、OBJ の机は無い
（裁判長の絵が机の上の端で切れている）。
"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import gfx  # noqa: E402
import nds  # noqa: E402

# data.bin の中の位置（ARM9 のリテラルから）
COURT_TILES = (0x1a9b274, 0x1900)    # 弁護側・検察側の机: 200 枚 = 64×64 × 3 + 16×32
COURT_PAL = 0x1ab1114
WITNESS_TILES = (0x1a9a674, 0xc00)   # 証言台: 96 枚 = 64×64 + 32×64
WITNESS_PAL = 0x1ab10f4

# (x, y, 幅, 高さ, 先頭から何枚目のタイルか, 左右反転)
DESKS = {
    'defense': (COURT_TILES, COURT_PAL, [
        (0, 144, 64, 64, 0, False), (64, 144, 64, 64, 64, False), (128, 144, 64, 64, 128, False),
        (192, 160, 16, 32, 192, False)]),
    'prosecution': (COURT_TILES, COURT_PAL, [
        (48, 160, 16, 32, 192, True), (64, 144, 64, 64, 128, True), (128, 144, 64, 64, 64, True),
        (192, 144, 64, 64, 0, True)]),
    'witness': (WITNESS_TILES, WITNESS_PAL, [
        (32, 152, 64, 64, 0, False), (96, 152, 32, 64, 64, False), (128, 152, 32, 64, 64, True),
        (160, 152, 64, 64, 0, True)]),
}

# ARM9 のリテラルに上の位置が載っていることを確かめる（別の版の ROM で黙って間違えないように）
EXPECTED_LITERALS = [COURT_TILES[0], COURT_PAL, WITNESS_TILES[0], WITNESS_PAL]


def obj_image(tiles: np.ndarray, first: int, w: int, h: int) -> np.ndarray:
    """1D マッピングの OBJ 1 個を h×w の色番号の配列にする"""
    n = (w // 8) * (h // 8)
    t = tiles[first:first + n]
    return t.reshape(h // 8, w // 8, 8, 8).transpose(0, 2, 1, 3).reshape(h, w)


def render(d: bytes, name: str) -> np.ndarray:
    """机を 256×192 の画面の上の位置に置いた RGBA 画像を返す"""
    (off, size), pal_off, objs = DESKS[name]
    tiles = gfx.unpack4(d[off:off + size]).reshape(-1, 8, 8)
    pal = np.array(gfx.palette(d[pal_off:pal_off + 32]), np.uint8)
    can = np.zeros((192, 256, 4), np.uint8)
    for x, y, w, h, first, flip in objs:
        idx = obj_image(tiles, first, w, h)
        if flip:
            idx = idx[:, ::-1]
        idx = idx[:max(0, 192 - y), :max(0, 256 - x)]       # 画面の外（y ≥ 192）は切る
        rgba = np.zeros(idx.shape + (4,), np.uint8)
        rgba[..., :3] = pal[idx]
        rgba[..., 3] = (idx != 0) * 255
        sub = can[y:y + idx.shape[0], x:x + idx.shape[1]]
        np.copyto(sub, rgba, where=rgba[..., 3:] != 0)
    return can


def check_arm9(arm9: bytes) -> None:
    words = set(np.frombuffer(arm9[:len(arm9) // 4 * 4], '<u4').tolist())
    missing = [f'{v:#x}' for v in EXPECTED_LITERALS if v not in words]
    if missing:
        raise SystemExit(f'ARM9 に机の位置が見つかりません（別の版の ROM？）: {", ".join(missing)}')


def export(d: bytes, arm9: bytes, out: Path) -> None:
    """data.bin と ARM9 から机を書き出す（extract_assets.py の desks の手順からも呼ぶ）"""
    check_arm9(arm9)
    out.mkdir(parents=True, exist_ok=True)
    for name in DESKS:
        img = render(d, name)
        gfx.write_rgba_png(out / f'{name}.png', img)
        ys = np.nonzero(img[..., 3].any(1))[0]
        xs = np.nonzero(img[..., 3].any(0))[0]
        print(f'  {name}: x {xs.min()}〜{xs.max()}, y {ys.min()}〜{ys.max()}')


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit('使い方: uv run tools/rom/ex_desks.py <rom.nds> [出力先]')
    rom = Path(sys.argv[1]).read_bytes()
    out = Path(sys.argv[2] if len(sys.argv) > 2 else Path(__file__).resolve().parents[2] / 'assets/extracted/data/desks')
    f = next(f for f in nds.list_files(rom) if f.path == 'data.bin')
    export(rom[f.start:f.end], nds.arm9(rom), out)


if __name__ == '__main__':
    main()
