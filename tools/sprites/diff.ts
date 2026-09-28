// 差分コマ（口パク・まばたき）をベースのコマと比べる・直す。ファイルの読み書きはしない。
import {
  changedMask,
  detectShift,
  estimateMask,
  inRects,
  isShifted,
  palette,
  type Rect,
  type Shift,
  shiftImage,
} from './checks.ts';
import { blank, type Rgba } from './png.ts';
import { SPEC } from './spec.ts';

export interface DiffResult {
  /** 変えてよい範囲（manifest で指定したもの、または推定したもの） */
  masks: Rect[];
  maskSource: 'manifest' | 'estimated' | 'none';
  /** 色が変わった点の数（全体・範囲の中・範囲の外） */
  changed: number;
  inside: number;
  outside: number;
  /** 範囲の中で変わった点が人物の点に占める割合 */
  changedFrac: number;
  /** 範囲の外で変わった点を囲む矩形 */
  outsideBox: Rect | null;
  /** ベースのパレットにない色の点の数 */
  newColorPx: number;
  shift: Shift;
  shifted: boolean;
}

export function compareFrames(
  base: Rgba,
  other: Rgba,
  role: string,
  masks?: Rect[],
  tol: number = SPEC.diff.tolerance,
): DiffResult {
  const { w, h } = base;
  const ch = changedMask(base, other, tol);
  let source: DiffResult['maskSource'] = masks?.length ? 'manifest' : 'none';
  let rects = masks ?? [];
  if (!rects.length) {
    const win = SPEC.diff.window[role];
    const r = win ? estimateMask(ch, w, h, win) : null;
    if (r) {
      rects = [r];
      source = 'estimated';
    }
  }
  let inside = 0,
    outside = 0,
    op = 0;
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (base.data[i * 4 + 3]) op++;
      if (!ch[i]) continue;
      if (inRects(rects, x, y)) {
        inside++;
        continue;
      }
      outside++;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  const basePal = palette(base);
  let newColorPx = 0;
  for (const [c, n] of palette(other)) if (!basePal.has(c)) newColorPx += n;
  const shift = detectShift(base, other);
  return {
    masks: rects,
    maskSource: source,
    changed: inside + outside,
    inside,
    outside,
    changedFrac: op ? inside / op : 0,
    outsideBox: x1 < 0 ? null : [x0, y0, x1 - x0 + 1, y1 - y0 + 1],
    newColorPx,
    shift,
    shifted: Boolean(isShifted(shift)),
  };
}

/** 確かめる用の画像: ベースを薄い灰色、範囲の中の違いを緑、範囲の外の違いを赤、範囲の枠を青で描く */
export function diffImage(
  base: Rgba,
  other: Rgba,
  masks: Rect[],
  tol: number = SPEC.diff.tolerance,
): Rgba {
  const { w, h } = base;
  const ch = changedMask(base, other, tol);
  const out = blank(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x,
        o = i * 4;
      const a = base.data[o + 3]!;
      const g = a
        ? 150 + (((base.data[o]! + base.data[o + 1]! + base.data[o + 2]!) / 3) * 90) / 255
        : 40;
      let px = [g, g, g, 255];
      if (ch[i]) px = inRects(masks, x, y) ? [40, 200, 60, 255] : [255, 0, 0, 255];
      else if (masks.some(([rx, ry, rw, rh]) => onBorder(x, y, rx, ry, rw, rh)))
        px = [40, 90, 255, 255];
      out.data.set(px, o);
    }
  }
  return out;
}

const onBorder = (x: number, y: number, rx: number, ry: number, rw: number, rh: number) =>
  x >= rx - 1 &&
  y >= ry - 1 &&
  x <= rx + rw &&
  y <= ry + rh &&
  (x === rx - 1 || y === ry - 1 || x === rx + rw || y === ry + rh);

/** いちばん近い色（RGB の差の二乗和） */
function nearest(colors: number[], c: number): number {
  let best = colors[0]!,
    bd = Infinity;
  for (const p of colors) {
    const d =
      ((p >> 16) - (c >> 16)) ** 2 +
      (((p >> 8) & 255) - ((c >> 8) & 255)) ** 2 +
      ((p & 255) - (c & 255)) ** 2;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

/**
 * 差分コマを直す: ずれていれば戻し、変えてよい範囲の外はベースの点で上書きし、
 * 範囲の中はベースのパレットのいちばん近い色に寄せ、透明度を 0 か 255 にそろえる。
 */
export function fixFrame(base: Rgba, other: Rgba, r: DiffResult): Rgba {
  const src = r.shifted ? shiftImage(other, r.shift.dx, r.shift.dy) : other;
  const colors = [...palette(base).keys()];
  const out = blank(base.w, base.h);
  for (let y = 0; y < base.h; y++) {
    for (let x = 0; x < base.w; x++) {
      const o = (y * base.w + x) * 4;
      if (!inRects(r.masks, x, y)) {
        out.data.set(base.data.subarray(o, o + 4), o);
        continue;
      }
      if (src.data[o + 3]! < 128 || !colors.length) continue;
      const c = nearest(colors, (src.data[o]! << 16) | (src.data[o + 1]! << 8) | src.data[o + 2]!);
      out.data.set([c >> 16, (c >> 8) & 255, c & 255, 255], o);
    }
  }
  return out;
}
