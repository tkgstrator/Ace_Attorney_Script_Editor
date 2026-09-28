#!/usr/bin/env python3
"""生成した証拠品画像を、ゲームで使うドット絵（透過PNG）に整える。

  python3 tools/evidence/postprocess.py            # raw/ の全画像を処理
  python3 tools/evidence/postprocess.py --size 64 --colors 24

処理内容:
  1. 背景のグリーンを透過にする（縁の色から背景色を自動判定）
  2. 輪郭に残った緑のにじみを取る
  3. 物体の範囲で切り抜き、正方形にそろえる
  4. 各マスの多数決で 64x64 に縮小する（ぼかさない）
  5. 色数を減らし、透明度を「完全に透明/不透明」の2値にする
  6. 一覧用のプレビュー画像 _preview.png を作る
"""
import argparse, pathlib
import numpy as np
from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parents[2]


def key_mask(rgb):
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]]).astype(int)
    key = np.median(border, axis=0)
    d = np.sqrt(((rgb.astype(int) - key) ** 2).sum(-1))
    r, g, b = [rgb[..., i].astype(int) for i in range(3)]
    greenish = (g > r + 60) & (g > b + 60) & (g > 140)
    return (d < 110) | greenish  # True = 背景


def despill(rgb, bg):
    # 背景の近く（4px以内）だけ緑を抑える
    near = bg.copy()
    for _ in range(4):
        n = near.copy()
        n[1:] |= near[:-1]; n[:-1] |= near[1:]; n[:, 1:] |= near[:, :-1]; n[:, :-1] |= near[:, 1:]
        near = n
    out = rgb.astype(int).copy()
    r, g, b = out[..., 0], out[..., 1], out[..., 2]
    lim = np.maximum(r, b)
    fix = near & ~bg & (g > lim)
    out[..., 1] = np.where(fix, lim, g)
    return out.clip(0, 255).astype(np.uint8)


def downscale(rgb, fg, size, margin):
    ys, xs = np.nonzero(fg)
    if len(xs) == 0:
        raise ValueError("物体が見つかりません（全面が背景と判定されました）")
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    side = max(x1 - x0, y1 - y0)
    inner = size - margin * 2
    cell = side / inner
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    ox, oy = cx - side / 2, cy - side / 2
    out = np.zeros((size, size, 4), np.uint8)
    H, W = fg.shape
    for j in range(inner):
        for i in range(inner):
            ax, bx = int(round(ox + i * cell)), int(round(ox + (i + 1) * cell))
            ay, by = int(round(oy + j * cell)), int(round(oy + (j + 1) * cell))
            ax, ay = max(ax, 0), max(ay, 0); bx, by = min(max(bx, ax + 1), W), min(max(by, ay + 1), H)
            if ax >= W or ay >= H:
                continue
            m = fg[ay:by, ax:bx]
            if m.mean() < 0.5:
                continue
            # マスの中央寄りの画素を優先して代表色を決める（境界のにじみを避ける）
            px = rgb[ay:by, ax:bx][m]
            out[j + margin, i + margin, :3] = np.median(px, axis=0)
            out[j + margin, i + margin, 3] = 255
    return out


def quantize(rgba, colors):
    img = Image.fromarray(rgba, "RGBA")
    alpha = img.getchannel("A")
    rgb = Image.new("RGB", img.size, (0, 0, 0)); rgb.paste(img.convert("RGB"), mask=alpha)
    q = rgb.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE).convert("RGB")
    q.putalpha(alpha.point(lambda a: 255 if a >= 128 else 0))
    return q


def preview(paths, out, scale=4, cols=6):
    tiles = [(p.stem, Image.open(p)) for p in paths]
    if not tiles:
        return
    s = tiles[0][1].width * scale
    pad = 12
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * (s + pad) + pad, rows * (s + pad + 14) + pad), (58, 56, 64))
    d = ImageDraw.Draw(sheet)
    for k, (name, im) in enumerate(tiles):
        x = pad + (k % cols) * (s + pad); y = pad + (k // cols) * (s + pad + 14)
        d.rectangle([x - 1, y - 1, x + s, y + s], fill=(110, 104, 118))
        sheet.paste(im.resize((s, s), Image.NEAREST), (x, y), im.resize((s, s), Image.NEAREST))
        d.text((x, y + s + 2), name, fill=(235, 230, 240))
    sheet.save(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=str(ROOT / "assets/generated/evidence/raw"))
    ap.add_argument("--dst", default=str(ROOT / "assets/evidence"))
    ap.add_argument("--size", type=int, default=64)
    ap.add_argument("--margin", type=int, default=2)
    ap.add_argument("--colors", type=int, default=24)
    a = ap.parse_args()
    src, dst = pathlib.Path(a.src), pathlib.Path(a.dst)
    dst.mkdir(parents=True, exist_ok=True)
    done = []
    for p in sorted(src.glob("*.png")):
        rgb = np.array(Image.open(p).convert("RGB"))
        bg = key_mask(rgb)
        rgb = despill(rgb, bg)
        icon = quantize(downscale(rgb, ~bg, a.size, a.margin), a.colors)
        out = dst / p.name
        icon.save(out)
        done.append(out)
        print(f"{p.name} -> {out.relative_to(ROOT) if out.is_relative_to(ROOT) else out}")
    preview(done, dst / "_preview.png")


if __name__ == "__main__":
    main()
