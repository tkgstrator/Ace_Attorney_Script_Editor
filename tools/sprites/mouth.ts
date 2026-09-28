// 口パクの絵を、基本の絵の口のまわりだけ差し替えたものに作り直す。
// 画像生成で「口だけ変えて」と頼んでも、輪郭や色が全体に少しずつ描き直されることがあるため、
// 違いがいちばん集まっている所（口）だけを口パクの絵から取り、ほかは基本の絵の点をそのまま使う。

/** 口を探す窓の大きさ（ドット）と、見つけた範囲の外側に足す余白 */
const WINDOW = { w: 12, h: 8 };
const MARGIN = 1;
/** 色の違いがこれより小さい点は同じとみなす（RGB の差の合計） */
const THRESHOLD = 48;

interface Rgba {
  w: number;
  h: number;
  data: Uint8Array;
}

/** base と talk（同じ大きさ）から、口のまわりだけ talk にした画像の RGBA を返す */
export function patchMouth(base: Rgba, talk: Rgba): Uint8Array {
  const { w, h } = base;
  const diff = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    let d = 0;
    for (let c = 0; c < 4; c++) d += Math.abs(base.data[i * 4 + c]! - talk.data[i * 4 + c]!);
    diff[i] = d > THRESHOLD ? 1 : 0;
  }
  // 顔のある上半分で、違いのいちばん多い窓を探す
  let best = { x: 0, y: 0, n: -1 };
  for (let y = 0; y + WINDOW.h <= h / 2; y++) {
    for (let x = 0; x + WINDOW.w <= w; x++) {
      let n = 0;
      for (let dy = 0; dy < WINDOW.h; dy++)
        for (let dx = 0; dx < WINDOW.w; dx++) n += diff[(y + dy) * w + x + dx]!;
      if (n > best.n) best = { x, y, n };
    }
  }
  // 窓の中の違いを囲む範囲に余白を足す
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let dy = 0; dy < WINDOW.h; dy++) {
    for (let dx = 0; dx < WINDOW.w; dx++) {
      const x = best.x + dx,
        y = best.y + dy;
      if (diff[y * w + x]) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  const out = base.data.slice();
  if (x1 < 0) return out;
  for (let y = Math.max(0, y0 - MARGIN); y <= Math.min(h - 1, y1 + MARGIN); y++) {
    for (let x = Math.max(0, x0 - MARGIN); x <= Math.min(w - 1, x1 + MARGIN); x++) {
      const i = (y * w + x) * 4;
      out.set(talk.data.subarray(i, i + 4), i);
    }
  }
  return out;
}
