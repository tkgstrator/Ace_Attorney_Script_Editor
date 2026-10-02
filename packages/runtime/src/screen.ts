// 画面の幅（4:3 / 16:9）。どちらも左の 256×192 ドットが DS 版の上画面と同じ画面で、配置は layout.ts の TOP・UI のまま。
// 16:9 は、その右に DS 版で下画面にあったボタンを並べる欄（panel.ts）を足す。画面にはボタンを重ねない。
import { type Rect, SCREEN_H, SCREEN_W } from './layout.ts';

export type Aspect = '4:3' | '16:9';

/** 16:9 で右に足す欄の幅（ドット）。DS 版の茶色のボタン（80 ドット）の左右に 3 ドットずつ空ける */
export const PANEL_W = 86;

/** 16:9 の画面全体の幅（ドット）。256 + 86 = 342 ≈ 192 × 16 / 9 */
export const WIDE_W = SCREEN_W + PANEL_W;

/** 画面全体の幅（ドット） */
export const screenWidth = (aspect: Aspect = '4:3'): number =>
  aspect === '16:9' ? WIDE_W : SCREEN_W;

export interface Layout {
  /** 画面全体（canvas）の大きさ（ドット）。DS 版の上画面にあたる部分は、どちらでも左上の 256×192 */
  w: number;
  h: number;
  /** 右の欄（4:3 なら null） */
  panel: Rect | null;
}

const cache = new Map<number, Layout>();

/** 幅 w の画面の配置 */
export function layoutFor(w: number = SCREEN_W): Layout {
  const hit = cache.get(w);
  if (hit) return hit;
  const panel = w > SCREEN_W ? { x: SCREEN_W, y: 0, w: w - SCREEN_W, h: SCREEN_H } : null;
  const layout: Layout = { w, h: SCREEN_H, panel };
  cache.set(w, layout);
  return layout;
}
