// 逆転裁判2・3 の遊びの表示: ライフのゲージ（最大が 10 を超える章）とサイコ・ロックの錠。
// ゲージは DS 版と同じく右上の横長の棒で、見当違いのときに減る量（lifeRisk）を点滅させる。
// 錠は、画面の中央に数だけ並べた錠前で表す（壊れた錠は出さない）。
import type { Painter } from './painter.ts';

/** ゲージの位置（4:3 のとき。画面の右に寄せる） */
const GAUGE = { x: 172, w: 80, h: 8 };

/** ゲージ（棒）で表すか（最大のライフが「！」で数えられないほど大きい） */
export const usesGauge = (max: number) => max > 10;

/** ライフのゲージ。risk の分は、frame に合わせて点滅させる。y は上端 */
export function lifeGauge(
  p: Painter,
  life: number,
  max: number,
  risk: number,
  frame: number,
  y: number,
) {
  const { w, h } = GAUGE;
  const x = GAUGE.x + p.layout.dx;
  const px = (v: number) => Math.round((Math.max(0, Math.min(max, v)) / max) * (w - 2));
  p.rect(x - 1, y - 1, w + 2, h + 2, '#101840');
  p.rect(x, y, w, h, '#303048');
  const full = px(life);
  const keep = px(life - risk);
  p.rect(x + 1, y + 1, keep, h - 2, '#48c8f0');
  p.rect(x + 1, y + 1, keep, 1, '#b8f0ff');
  if (full > keep && Math.floor(frame / 8) % 2 === 0)
    p.rect(x + 1 + keep, y + 1, full - keep, h - 2, '#f05030');
}

/** 錠前 1 個（16×18 ドット）。左上が (x, y) */
function padlock(p: Painter, x: number, y: number, color: string) {
  // つる
  p.rect(x + 3, y, 10, 2, color);
  p.rect(x + 3, y, 2, 8, color);
  p.rect(x + 11, y, 2, 8, color);
  // 本体
  p.rect(x, y + 7, 16, 11, '#200808');
  p.rect(x + 1, y + 8, 14, 9, color);
  p.rect(x + 7, y + 11, 2, 4, '#200808');
}

/** サイコ・ロックの錠（残りの数だけ、画面の上のほうに横に並べる） */
export function psycheLocks(p: Painter, left: number, frame: number) {
  if (left <= 0) return;
  const gap = 22;
  const x0 = Math.round((p.layout.w - (left * gap - (gap - 16))) / 2);
  const glow = Math.floor(frame / 20) % 2 === 0 ? '#e02828' : '#c01818';
  for (let i = 0; i < left; i++) padlock(p, x0 + i * gap, 40, glow);
}

/** 話題に付けるサイコ・ロックの印（小さな錠前）。左上が (x, y) */
export function lockMark(p: Painter, x: number, y: number) {
  p.rect(x + 2, y, 5, 1, '#c01818');
  p.rect(x + 2, y, 1, 4, '#c01818');
  p.rect(x + 6, y, 1, 4, '#c01818');
  p.rect(x, y + 4, 9, 6, '#c01818');
  p.rect(x + 4, y + 6, 1, 2, '#200808');
}
