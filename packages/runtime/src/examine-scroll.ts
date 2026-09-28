// 「調べる」の間の背景のスクロール（元のゲームの動きをまねる）。
//
// 元のゲーム（ARM9、下の画面 6 番「調べる」の主の処理 0x02058b3c）:
//   - 調べる場所の表の座標は背景の座標。当たり判定は「カーソル（画面の点）+ 背景の位置（0x020ce300+0x1c/0x1e）」を
//     中心にした 16×16 の四角（0x020353dc）
//   - 横長の背景（背景のフラグ & 3 が 0 でない）では、L ボタン（または下の画面の真ん中のボタン。どちらもキーの 0x200）で
//     背景を動かす（0x020591b0〜）: 位置 x が 0 なら右へ、0x80・0x100 なら左へ、1 フレーム 6 ドット（+0x24 = ±6、
//     +0x16 = 1）。動きは bg_effect（29）と同じ処理（0x0201f114）で、端で止まり、人物も一緒に動く。
//     それ以外の位置では動かない。動いている間は操作を受け付けない（0x02058a38 が止まるのを待って主の処理へ戻る）
//   - 十字キーはカーソルを動かす（1 フレーム 3 ドット）だけで、背景は動かさない
// ここでは縦長の背景も同じ規則で上下に動かす（元のゲームの探偵パートには縦長の背景の場所は無い）。
// 広い画面（16:9）では、端は見える幅で決める。0x80・0x100 は 4:3 の画面の左端の位置なので、4:3 の枠の位置に直して比べる。
import { SCREEN_H, SCREEN_W } from './layout.ts';

/** 1 フレームに動く量（ドット） */
export const EXAMINE_SCROLL_SPEED = 6;

/** 背景の今の位置と大きさ */
export interface BackgroundPos {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 今の位置から「調べる」のスクロールで動く向き（1 フレームの速さ）。動かせなければ null。
 * 横長なら左右（左端なら右へ、右端・0x80・0x100 なら左へ）、縦長なら上下（上端なら下へ、下端なら上へ）
 */
export function examineScrollStep(
  v: BackgroundPos,
  screenW = SCREEN_W,
  screenH = SCREEN_H,
): { x: number; y: number } | null {
  const s = EXAMINE_SCROLL_SPEED;
  if (v.w > screenW) {
    const max = v.w - screenW;
    // 4:3 の枠の左端の位置（4:3 なら v.x のまま）
    const x43 = v.x + Math.floor((screenW - SCREEN_W) / 2);
    if (v.x <= 0) return { x: s, y: 0 };
    if (v.x >= max || x43 === 0x80 || x43 === 0x100) return { x: -s, y: 0 };
    return null;
  }
  if (v.h > screenH) {
    const max = v.h - screenH;
    if (v.y <= 0) return { x: 0, y: s };
    if (v.y >= max) return { x: 0, y: -s };
  }
  return null;
}
