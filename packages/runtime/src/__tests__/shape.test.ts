import { describe, expect, it } from 'bun:test';
import { shapeRuns, spansOf, type Run } from '../shape.ts';

/** 横の並びを、画素ごとの色の表に戻す */
function grid(runs: Run[]): Map<string, string> {
  const g = new Map<string, string>();
  for (const r of runs) for (let x = r.x; x < r.x + r.w; x++) g.set(`${x},${r.y}`, r.color);
  return g;
}

describe('shapeRuns', () => {
  it('四角形は外側から縁の層、内側の縁は向きごとの色、残りは塗りになる', () => {
    const g = grid(
      shapeRuns(
        spansOf(10, 19, () => [10, 19]),
        {
          edges: ['W', 'E'],
          fill: 'F',
          inner: { top: 'T', bottom: 'B', left: 'L', right: 'R' },
        },
      ),
    );
    expect(g.get('10,10')).toBe('W');
    expect(g.get('11,11')).toBe('E');
    expect(g.get('15,12')).toBe('T');
    expect(g.get('15,17')).toBe('B');
    expect(g.get('12,15')).toBe('L');
    expect(g.get('17,15')).toBe('R');
    expect(g.get('15,15')).toBe('F');
    expect(g.size).toBe(100);
  });

  it('斜めの辺も 1 ドット幅の縁が続き、角だけで外と接する画素は中間の色になる', () => {
    // 右下がりの斜めの辺（行 y では x <= y まで）
    const g = grid(
      shapeRuns(
        spansOf(0, 9, (y) => [0, y + 5]),
        { edges: ['E'], fill: 'F', aa: 'A', screenInside: true },
      ),
    );
    expect(g.get('8,3')).toBe('E');
    expect(g.get('7,3')).toBe('A');
    expect(g.get('3,3')).toBe('F');
    // 画面の端（x = 0・y = 0）は内側とみなすので縁が付かない
    expect(g.get('0,4')).toBe('F');
  });
});
