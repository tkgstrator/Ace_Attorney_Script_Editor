// 探索編の「調べる」で今選べる所と、その目印を置く点（表示の手助け。状態は変えない）。
// 当たり判定は examineAt（investigation.ts）と同じ: when が真のもののうち、先に並んだものが優先。
import { evalExpr } from './expr.ts';
import { stateEnv } from './state.ts';
import type { CompiledScenario, Expr, GameState } from './types.ts';

type Area = [number, number, number, number];

export interface ExamineSpot {
  /** 調べた印の ID（seen() で使うもの） */
  id: string;
  name?: string;
  /** 範囲（背景の座標） */
  area: Area;
  /** もう調べたか（state.seen に入っているか） */
  seen: boolean;
  /**
   * 目印を置く点（背景の座標。画面に描くときは背景のスクロールした位置を引く）。この点を調べると、必ずこの所に当たる。
   * 手前の所にすっかり隠れて、どこを調べても当たらないときは null
   */
  point: [number, number] | null;
}

/** 目印を範囲の端からこれだけ内側に置く（細い所では真ん中まで） */
const MARGIN = 3;

const inside = ([x, y, w, h]: Area, px: number, py: number) =>
  px >= x && px < x + w && py >= y && py < y + h;

/**
 * 今の探偵メニューの場所で、調べて当たる所（when が真のもの）の一覧。
 * 探偵メニューにいないときは空。条件式を評価できないもの（未定義のフラグなど）は選べないものとする
 */
export function examineSpots(
  scenario: CompiledScenario,
  state: Readonly<GameState>,
): ExamineSpot[] {
  if (state.mode !== 'investigate') return [];
  const place = scenario.scenes[state.scene];
  if (place?.kind !== 'place') return [];
  const env = stateEnv(() => state);
  const test = (e: Expr | undefined) => {
    if (e === undefined) return true;
    try {
      return !!evalExpr(e, env);
    } catch {
      return false;
    }
  };
  return place.examine
    .filter((e) => test(e.when))
    .map((e, i, all) => ({
      id: e.id,
      ...(e.name ? { name: e.name } : {}),
      area: e.area,
      seen: state.seen.includes(e.id),
      point: markerPoint(
        e.area,
        all.slice(0, i).map((x) => x.area),
      ),
    }));
}

/**
 * 範囲 area の目印の点。基本は中心で、先に並んだ範囲（before。当たり判定で優先されるもの）に隠れるなら、
 * area のうち隠れていない所で、中心にいちばん近い点にする（端から少し内側）。
 * 隠れていない所は、範囲の端で区切った格子のます目ごとに調べる（ます目の中はどこも同じ当たり方になる）
 */
export function markerPoint(area: Area, before: Area[]): [number, number] | null {
  const [x, y, w, h] = area;
  if (w <= 0 || h <= 0) return null;
  const owns = (px: number, py: number) =>
    inside(area, px, py) && !before.some((b) => inside(b, px, py));
  const cx = x + Math.floor(w / 2),
    cy = y + Math.floor(h / 2);
  if (owns(cx, cy)) return [cx, cy];
  const cuts = (lo: number, hi: number, edges: number[]) =>
    [...new Set([lo, hi, ...edges.filter((v) => v > lo && v < hi)])].sort((a, b) => a - b);
  const xs = cuts(
    x,
    x + w,
    before.flatMap((b) => [b[0], b[0] + b[2]]),
  );
  const ys = cuts(
    y,
    y + h,
    before.flatMap((b) => [b[1], b[1] + b[3]]),
  );
  let best: { p: [number, number]; d: number; roomy: boolean } | null = null;
  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < ys.length; j++) {
      const [x0, x1, y0, y1] = [xs[i]!, xs[i + 1]!, ys[j]!, ys[j + 1]!];
      if (!owns(x0, y0)) continue;
      const px = clampIn(cx, x0, x1),
        py = clampIn(cy, y0, y1);
      const d = (px - cx) ** 2 + (py - cy) ** 2;
      // 目印（5×5 ほど）が収まる広さのます目を優先する
      const roomy = x1 - x0 >= 5 && y1 - y0 >= 5;
      if (!best || (roomy && !best.roomy) || (roomy === best.roomy && d < best.d))
        best = { p: [px, py], d, roomy };
    }
  }
  return best ? best.p : null;
}

/** v を [lo, hi) の整数に収める（端から MARGIN だけ内側。狭ければ真ん中） */
function clampIn(v: number, lo: number, hi: number): number {
  const m = Math.min(MARGIN, Math.floor((hi - 1 - lo) / 2));
  return Math.max(lo + m, Math.min(hi - 1 - m, v));
}
