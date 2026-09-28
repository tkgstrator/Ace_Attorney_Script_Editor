// 立ち絵のコマを確かめる計算（ファイルの読み書きはしない。check.ts とテストから使う）。
import { blank, type Rgba } from './png.ts';
import { type Size, SPEC } from './spec.ts';

/** 矩形 [x, y, w, h]（コマの座標、ドット） */
export type Rect = [number, number, number, number];

const opaque = (img: Rgba, i: number) => img.data[i * 4 + 3]! > 0;
const rgb = (img: Rgba, i: number) =>
  (img.data[i * 4]! << 16) | (img.data[i * 4 + 1]! << 8) | img.data[i * 4 + 2]!;
const lum = (c: number) => 0.299 * (c >> 16) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255);
/** DS の 5 ビットの色の段（8 ビットでは c * 255 // 31） */
const RGB5 = new Set(Array.from({ length: 32 }, (_, c) => Math.floor((c * 255) / 31)));

/** 不透明な点の色ごとの数 */
export function palette(img: Rgba): Map<number, number> {
  const m = new Map<number, number>();
  for (let i = 0; i < img.w * img.h; i++) {
    if (opaque(img, i)) m.set(rgb(img, i), (m.get(rgb(img, i)) ?? 0) + 1);
  }
  return m;
}

export function bbox(img: Rgba): Rect | null {
  let x0 = img.w,
    y0 = img.h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (!opaque(img, y * img.w + x)) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

export interface FrameStats {
  w: number;
  h: number;
  opaque: number;
  /** 半透明（0 でも 255 でもない）の点の数 */
  semiAlpha: number;
  colors: number;
  /** アンチエイリアスの疑いのある点の割合（左右か上下の点の中間の色で、同じ色の隣がない） */
  aaSuspect: number;
  /** 輪郭（透明に接する点）のうち、いちばん暗い 3 色の割合 */
  outlineDark: number;
  /** 色が DS の 15 ビット色の段に乗っている割合（参考） */
  rgb555: number;
  /** 人物の上端・下端（画面の y。キャンバスが画面より小さいときは下端・中央に置いたとして） */
  top: number | null;
  bottom: number | null;
}

export function frameStats(img: Rgba): FrameStats {
  const { w, h } = img;
  const pal = palette(img);
  const dark = new Set([...pal.keys()].sort((a, b) => lum(a) - lum(b)).slice(0, 3));
  let n = 0,
    semi = 0,
    aa = 0,
    edge = 0,
    edgeDark = 0;
  const same = (i: number, j: number) => opaque(img, j) && rgb(img, j) === rgb(img, i);
  const between = (i: number, a: number, b: number) => {
    if (!opaque(img, a) || !opaque(img, b)) return false;
    const [ca, cb, c] = [rgb(img, a), rgb(img, b), rgb(img, i)];
    if (ca === cb || c === ca || c === cb) return false;
    return [16, 8, 0].every((s) => {
      const [va, vb, v] = [(ca >> s) & 255, (cb >> s) & 255, (c >> s) & 255];
      return v >= Math.min(va, vb) && v <= Math.max(va, vb);
    });
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = img.data[i * 4 + 3]!;
      if (a > 0 && a < 255) semi++;
      if (!a) continue;
      n++;
      const nb = [
        x > 0 ? i - 1 : -1,
        x < w - 1 ? i + 1 : -1,
        y > 0 ? i - w : -1,
        y < h - 1 ? i + w : -1,
      ];
      if (nb.some((j) => j < 0 || !opaque(img, j))) {
        edge++;
        if (dark.has(rgb(img, i))) edgeDark++;
      }
      const lonely = !nb.some((j) => j >= 0 && same(i, j));
      const mid =
        (nb[0]! >= 0 && nb[1]! >= 0 && between(i, nb[0]!, nb[1]!)) ||
        (nb[2]! >= 0 && nb[3]! >= 0 && between(i, nb[2]!, nb[3]!));
      if (lonely && mid) aa++;
    }
  }
  const box = bbox(img);
  const dy = h < SPEC.screen.h ? SPEC.screen.h - h : 0;
  const on5 = [...pal.keys()].filter((c) => [16, 8, 0].every((s) => RGB5.has((c >> s) & 255)));
  return {
    w,
    h,
    opaque: n,
    semiAlpha: semi,
    colors: pal.size,
    aaSuspect: n ? aa / n : 0,
    outlineDark: edge ? edgeDark / edge : 1,
    rgb555: pal.size ? on5.length / pal.size : 1,
    top: box ? box[1] + dy : null,
    bottom: box ? box[1] + box[3] - 1 + dy : null,
  };
}

/** 2 つのコマで、その点の色が違うか（透明どうしは同じ） */
function differs(a: Rgba, b: Rgba, i: number, tol: number): boolean {
  const oa = opaque(a, i),
    ob = opaque(b, i);
  if (oa !== ob) return true;
  if (!oa) return false;
  let d = 0;
  for (let c = 0; c < 3; c++) d += Math.abs(a.data[i * 4 + c]! - b.data[i * 4 + c]!);
  return d > tol;
}

export function changedMask(a: Rgba, b: Rgba, tol: number = SPEC.diff.tolerance): Uint8Array {
  const m = new Uint8Array(a.w * a.h);
  for (let i = 0; i < m.length; i++) m[i] = differs(a, b, i, tol) ? 1 : 0;
  return m;
}

/** 違いのいちばん集まっている窓を探し、その中の違いを囲む矩形（余白つき）を返す。顔のある上半分だけを見る */
export function estimateMask(
  changed: Uint8Array,
  w: number,
  h: number,
  win: Size,
  margin: number = SPEC.diff.margin,
): Rect | null {
  // 累積和で窓の中の数を数える
  const S = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      S[(y + 1) * (w + 1) + x + 1] =
        changed[y * w + x]! +
        S[y * (w + 1) + x + 1]! +
        S[(y + 1) * (w + 1) + x]! -
        S[y * (w + 1) + x]!;
    }
  }
  const sum = (x: number, y: number, ww: number, hh: number) =>
    S[(y + hh) * (w + 1) + x + ww]! -
    S[y * (w + 1) + x + ww]! -
    S[(y + hh) * (w + 1) + x]! +
    S[y * (w + 1) + x]!;
  const ww = Math.min(win.w, w),
    hh = Math.min(win.h, h);
  let best = { x: 0, y: 0, n: 0 };
  for (let y = 0; y + hh <= Math.max(hh, Math.ceil(h / 2)); y++) {
    for (let x = 0; x + ww <= w; x++) {
      const n = sum(x, y, ww, hh);
      if (n > best.n) best = { x, y, n };
    }
  }
  if (!best.n) return null;
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = best.y; y < best.y + hh; y++) {
    for (let x = best.x; x < best.x + ww; x++) {
      if (!changed[y * w + x]) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  }
  x0 = Math.max(0, x0 - margin);
  y0 = Math.max(0, y0 - margin);
  x1 = Math.min(w - 1, x1 + margin);
  y1 = Math.min(h - 1, y1 + margin);
  return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
}

export function inRects(rects: Rect[], x: number, y: number): boolean {
  return rects.some(([rx, ry, rw, rh]) => x >= rx && y >= ry && x < rx + rw && y < ry + rh);
}

export interface Shift {
  dx: number;
  dy: number;
  /** ずらさないときと、いちばん合うずらし方のときの、不透明な範囲の食い違いの点の数 */
  before: number;
  after: number;
}

/** other を (dx, dy) ずらすと base にいちばん重なるか（不透明な範囲で比べる） */
export function detectShift(base: Rgba, other: Rgba, r: number = SPEC.diff.shiftSearch): Shift {
  const { w, h } = base;
  const miss = (dx: number, dy: number) => {
    let n = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const sx = x - dx,
          sy = y - dy;
        const o = sx >= 0 && sy >= 0 && sx < w && sy < h && opaque(other, sy * w + sx);
        if (o !== opaque(base, y * w + x)) n++;
      }
    }
    return n;
  };
  const before = miss(0, 0);
  let best: Shift = { dx: 0, dy: 0, before, after: before };
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const n = miss(dx, dy);
      if (n < best.after) best = { dx, dy, before, after: n };
    }
  }
  return best;
}

/** ずれと判定するか: ずらすと食い違いが半分以下になり、20 点以上減る */
export const isShifted = (s: Shift) =>
  (s.dx || s.dy) && s.after <= s.before / 2 && s.before - s.after >= 20;

export function shiftImage(img: Rgba, dx: number, dy: number): Rgba {
  const out = blank(img.w, img.h);
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      const sx = x - dx,
        sy = y - dy;
      if (sx < 0 || sy < 0 || sx >= img.w || sy >= img.h) continue;
      const s = (sy * img.w + sx) * 4;
      out.data.set(img.data.subarray(s, s + 4), (y * img.w + x) * 4);
    }
  }
  return out;
}
