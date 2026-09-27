// 縁取りのある形（タブ・ボタン・板）を、1 ドットずつの層に塗り分ける。
// 形は行ごとの範囲で表し、外側からの距離（上下左右にたどった歩数）で縁の色を決める。
// 斜めの辺も 1 行に 1 ドットずつずれる階段になるので、DS 版の絵と同じように縁が 1 ドット幅で続く。

/** 1 行の範囲 [左端, 右端]（どちらも含む）。null はその行に何もない */
export type Span = readonly [number, number] | null;

/** 形。範囲 (x0, y0)〜(x1, y1)（どちらも含む）の中で、inside が true の画素 */
export interface Shape { x0: number; y0: number; x1: number; y1: number; inside(x: number, y: number): boolean }

/** 内側の縁（外から edges.length + 1 番目の層）の色。向きは、一番近い外側がどちらにあるか */
export interface InnerEdge { top?: string; bottom?: string; left?: string; right?: string; slant?: string }

export interface ShapeStyle {
  /** 外側から順に、縁の層の色 */
  edges: string[];
  fill: string;
  inner?: InnerEdge;
  /**
   * 斜めの辺のすぐ内側（外と角だけで接する画素）の色。DS 版の絵では、斜めの辺に中間の色が 1 ドット入る
   */
  aa?: string;
  /** 画面の外を形の内側とみなす（画面の端に接する辺には縁を付けない） */
  screenInside?: boolean;
}

/** 同じ色が続く横の並び */
export interface Run { x: number; y: number; w: number; color: string }

const SCREEN_W = 256, SCREEN_H = 192;

/** 形を、色ごとの横の並びに分ける */
export function shapeRuns(shape: Shape, style: ShapeStyle): Run[] {
  const { x0: minX, y0, x1: maxX, y1 } = shape;
  const inside = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= SCREEN_W || y >= SCREEN_H) return style.screenInside ?? false;
    return x >= minX && x <= maxX && y >= y0 && y <= y1 && shape.inside(x, y);
  };
  // 外からの距離（上下左右の歩数）。形の周り 1 ドットを含めた枠で、2 回なめて求める
  const bx = minX - 1, by = y0 - 1, bw = maxX - minX + 3, bh = y1 - y0 + 3;
  const far = 1 << 20;
  const dist = new Int32Array(bw * bh);
  for (let j = 0; j < bh; j++) {
    for (let i = 0; i < bw; i++) {
      const x = bx + i, y = by + j;
      if (!inside(x, y)) { dist[j * bw + i] = 0; continue; }
      // 枠の端の画素は、枠の外（画面の外なら内側とみなす）を見て決める
      const edge = i === 0 || j === 0 || i === bw - 1 || j === bh - 1;
      dist[j * bw + i] = edge && ![[-1, 0], [1, 0], [0, -1], [0, 1]].every(([dx, dy]) => inside(x + dx!, y + dy!)) ? 1 : far;
    }
  }
  const at = (i: number, j: number) => (i < 0 || j < 0 || i >= bw || j >= bh ? (inside(bx + i, by + j) ? far : 0) : dist[j * bw + i]!);
  for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
    const k = j * bw + i;
    if (dist[k]) dist[k] = Math.min(dist[k]!, at(i - 1, j) + 1, at(i, j - 1) + 1);
  }
  for (let j = bh - 1; j >= 0; j--) for (let i = bw - 1; i >= 0; i--) {
    const k = j * bw + i;
    if (dist[k]) dist[k] = Math.min(dist[k]!, at(i + 1, j) + 1, at(i, j + 1) + 1);
  }

  const n = style.edges.length;
  const colorAt = (x: number, y: number): string | null => {
    const d = at(x - bx, y - by);
    if (d === 0 || !inside(x, y)) return null;
    if (d <= n) return style.edges[d - 1]!;
    if (style.aa && d === n + 1 && [[-1, -1], [1, -1], [-1, 1], [1, 1]].some(([dx, dy]) => !inside(x + dx! * n, y + dy! * n))) return style.aa;
    if (style.inner && d === n + 1) {
      const r = n + 1, s = style.inner;
      if (s.top && !inside(x, y - r)) return s.top;
      if (s.bottom && !inside(x, y + r)) return s.bottom;
      if (s.left && !inside(x - r, y)) return s.left;
      if (s.right && !inside(x + r, y)) return s.right;
      if (s.slant) return s.slant;
    }
    return style.fill;
  };

  const runs: Run[] = [];
  for (let y = y0; y <= y1; y++) {
    let start = minX, color = colorAt(minX, y);
    for (let x = minX + 1; x <= maxX + 1; x++) {
      const c = x <= maxX ? colorAt(x, y) : null;
      if (c === color) continue;
      if (color) runs.push({ x: start, y, w: x - start, color });
      start = x;
      color = c;
    }
  }
  return runs;
}

/** 行 y0〜y1 の範囲を、行ごとの関数で作る */
export function spansOf(y0: number, y1: number, row: (y: number) => Span): Shape {
  const spans: Span[] = [];
  for (let y = y0; y <= y1; y++) spans.push(row(y));
  const xs = spans.filter((s): s is readonly [number, number] => s !== null);
  return {
    x0: Math.min(...xs.map(s => s[0])), y0, x1: Math.max(...xs.map(s => s[1])), y1,
    inside: (x, y) => { const s = spans[y - y0]; return !!s && x >= s[0] && x <= s[1]; },
  };
}
