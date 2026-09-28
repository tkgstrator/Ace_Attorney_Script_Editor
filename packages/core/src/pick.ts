// 絵の上の範囲を選ぶ（pick）の、状態を変えない計算。当たり判定は探索編の「調べる」（examineAt）と同じく、
// 今選べる範囲のうち先に並んだものが優先。状態の変更は Engine が行う。
import { markerPoint } from './examine-spots.ts';
import type { Area, Expr, Instr } from './types.ts';

type Test = (e: Expr | undefined) => boolean;
type PickInstr = Extract<Instr, { op: 'pick' }>;

const inside = ([x, y, w, h]: Area, px: number, py: number) =>
  px >= x && px < x + w && py >= y && py < y + h;

/** その範囲が絵 image の上にあるか（image の無い範囲はどの絵の上にもある） */
export const onImage = (o: { image?: number | null }, image: number) =>
  o.image === undefined || o.image === null || o.image === image;

/**
 * 絵 image の上の点 (x, y) を選んだときの、今選べるものの中の番号（Engine.pick に渡す）。
 * 範囲に当たらなければ範囲の外、範囲の外も選べなければ null
 */
export function pickIndexAt(
  ins: PickInstr,
  x: number,
  y: number,
  image: number,
  test: Test,
): number | null {
  const shown = ins.options.filter((o) => test(o.when));
  const hit = shown.findIndex(
    (o) => o.kind === 'area' && o.area && onImage(o, image) && inside(o.area, x, y),
  );
  if (hit >= 0) return hit;
  const miss = shown.findIndex((o) => o.kind === 'miss');
  return miss >= 0 ? miss : null;
}

/**
 * 絵 image の上で、今選べる範囲の目印を置く点（絵の座標）。手前の範囲にすっかり隠れた範囲は null。
 * 目印の置き方は「調べる」の目印（examineSpots）と同じ
 */
export function pickMarkers(
  areas: readonly { area: Area; image: number | null }[],
  image: number,
): ([number, number] | null)[] {
  const on = areas.filter((a) => onImage(a, image)).map((a) => a.area);
  return on.map((a, i) => markerPoint(a, on.slice(0, i)));
}
