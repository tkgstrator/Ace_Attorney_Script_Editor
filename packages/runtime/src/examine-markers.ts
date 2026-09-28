// 「調べる」で選べる所の目印（元のゲームにはない手助け。PlayerOptions.examineMarkers で出し分ける）。
// どれも 7×7 ドットほどの小さな印で、調べるときのカーソル（十字）の真ん中の空きに収まる大きさにする。
// まだ調べていない所は目立つ色のひし形がゆっくり脈打ち、調べた所は落ち着いた色のチェックの印（形でも見分けられる）
import type { ExamineSpot } from '@gyakusai/core';
import type { Painter } from './painter.ts';

const EDGE = '#000000';
const FRESH = '#f8c030';
const FRESH_CORE = '#fff8d0';
const DONE = '#90b0a8';
/** 脈打つ周期（フレーム）。このうち前の SMALL_FRAMES フレームは小さく描く */
const PULSE_FRAMES = 60;
const SMALL_FRAMES = 20;

/** 目印を描く。reduceMotion なら脈打たない */
export function drawExamineMarkers(
  p: Painter,
  spots: readonly ExamineSpot[],
  frame: number,
  reduceMotion = false,
): void {
  const small = !reduceMotion && frame % PULSE_FRAMES < SMALL_FRAMES;
  for (const s of spots) {
    if (!s.point) continue;
    const [x, y] = s.point;
    if (s.seen) check(p, x, y);
    else diamond(p, x, y, small ? 2 : 3);
  }
}

/** まだ調べていない所: 黒い縁のひし形（半径 r）。真ん中を明るくする */
function diamond(p: Painter, x: number, y: number, r: number) {
  for (let dy = -r; dy <= r; dy++) {
    const k = r - Math.abs(dy);
    p.rect(x - k, y + dy, k * 2 + 1, 1, EDGE);
    if (k > 0) p.rect(x - k + 1, y + dy, k * 2 - 1, 1, FRESH);
  }
  p.rect(x, y, 1, 1, FRESH_CORE);
}

/** チェックの印の点（中心からのずれ）。左下がりの短い線と右上がりの長い線 */
const CHECK_DOTS: readonly [number, number][] = [
  [-3, 0],
  [-2, 1],
  [-1, 2],
  [0, 1],
  [1, 0],
  [2, -1],
  [3, -2],
];

/** 調べた所: 黒い縁のチェックの印 */
function check(p: Painter, x: number, y: number) {
  for (const [dx, dy] of CHECK_DOTS) p.rect(x + dx - 1, y + dy - 1, 3, 3, EDGE);
  for (const [dx, dy] of CHECK_DOTS) p.rect(x + dx, y + dy, 1, 1, DONE);
}
