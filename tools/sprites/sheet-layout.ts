// スプライトシート（複数のコマを 1 枚にまとめた生成用の画像）の作り方と切り分け方。
// ファイルの読み書きはしない（sheet.ts とテストから使う）。決まりは SPEC.md の「スプライトシート」の節。
import { bbox, palette, type Rect } from './checks.ts';
import { blank, type Rgba } from './png.ts';

export type Rgb = [number, number, number];

export interface SheetLayout {
  id: string;
  /** コマ（キャンバス）の大きさ（ドット） */
  frame: { w: number; h: number };
  /** 枠に入れる範囲（コマの座標。ベースの人物の範囲に余白を足したもの） */
  crop: Rect;
  /** 1 ドットをシートの何 px で描くか */
  scale: number;
  /** 枠と枠のあいだ（ガイドの線の太さ、px） */
  gutter: number;
  cols: number;
  rows: number;
  /** 枠の並び（左上から右へ、行ごと）。最初はベース */
  cells: string[];
  /** 背景の色（透明にする）とガイドの線の色 */
  bg: Rgb;
  guide: Rgb;
  /** シート全体の大きさ（px） */
  w: number;
  h: number;
}

export const SHEET_DEFAULTS = {
  cells: ['base', 'talk1', 'talk2', 'blink1', 'blink2'],
  bg: [255, 0, 255] as Rgb,
  guide: [0, 255, 255] as Rgb,
  margin: 4,
  gutter: 8,
  /** 画像生成で頼める大きさの上限（px） */
  max: { w: 1536, h: 1536 },
};

/** ベースのコマから、シートの並びと倍率を決める（上限に収まるいちばん大きな整数倍） */
export function planSheet(
  id: string,
  base: Rgba,
  cells: string[] = SHEET_DEFAULTS.cells,
  max = SHEET_DEFAULTS.max,
): SheetLayout {
  const b = bbox(base) ?? [0, 0, base.w, base.h];
  const m = SHEET_DEFAULTS.margin,
    g = SHEET_DEFAULTS.gutter;
  const x0 = Math.max(0, b[0] - m),
    y0 = Math.max(0, b[1] - m);
  const crop: Rect = [
    x0,
    y0,
    Math.min(base.w, b[0] + b[2] + m) - x0,
    Math.min(base.h, b[1] + b[3] + m) - y0,
  ];
  let best: { cols: number; rows: number; scale: number } | null = null;
  for (let cols = 1; cols <= cells.length; cols++) {
    const rows = Math.ceil(cells.length / cols);
    const scale = Math.floor(
      Math.min(
        (max.w - g * (cols + 1)) / (crop[2] * cols),
        (max.h - g * (rows + 1)) / (crop[3] * rows),
      ),
    );
    if (scale >= 1 && (!best || scale > best.scale)) best = { cols, rows, scale };
  }
  if (!best) throw new Error('シートに収まりません（コマが大きすぎます）');
  const { cols, rows, scale } = best;
  return {
    id,
    frame: { w: base.w, h: base.h },
    crop,
    scale,
    gutter: g,
    cols,
    rows,
    cells,
    bg: SHEET_DEFAULTS.bg,
    guide: SHEET_DEFAULTS.guide,
    w: cols * crop[2] * scale + (cols + 1) * g,
    h: rows * crop[3] * scale + (rows + 1) * g,
  };
}

/** 枠 k の左上（シートの px） */
export function cellOrigin(l: SheetLayout, k: number): { x: number; y: number } {
  const col = k % l.cols,
    row = Math.floor(k / l.cols);
  return {
    x: l.gutter + col * (l.crop[2] * l.scale + l.gutter),
    y: l.gutter + row * (l.crop[3] * l.scale + l.gutter),
  };
}

/** 生成に渡すシート: ガイドの線と背景を描き、ベースを最初の枠に（prefill なら全部の枠に）置く */
export function drawSheet(l: SheetLayout, base: Rgba, prefill = true): Rgba {
  const out = blank(l.w, l.h);
  for (let i = 0; i < l.w * l.h; i++) out.data.set([...l.guide, 255], i * 4);
  const [cx, cy, cw, ch] = l.crop;
  l.cells.forEach((_, k) => {
    const o = cellOrigin(l, k);
    for (let y = 0; y < ch * l.scale; y++) {
      for (let x = 0; x < cw * l.scale; x++) {
        const s = ((cy + Math.floor(y / l.scale)) * base.w + cx + Math.floor(x / l.scale)) * 4;
        const on = (k === 0 || prefill) && base.data[s + 3]! > 0;
        const px = on ? [base.data[s]!, base.data[s + 1]!, base.data[s + 2]!, 255] : [...l.bg, 255];
        out.data.set(px, ((o.y + y) * l.w + o.x + x) * 4);
      }
    }
  });
  return out;
}

const dist = (d: Uint8Array, i: number, c: Rgb) =>
  Math.abs(d[i]! - c[0]) + Math.abs(d[i + 1]! - c[1]) + Math.abs(d[i + 2]! - c[2]);

/** ガイドの色が大半を占める列（行）のまとまりを探し、そのあいだを枠とする */
function bands(img: Rgba, guide: Rgb, vertical: boolean): [number, number][] {
  const n = vertical ? img.w : img.h,
    m = vertical ? img.h : img.w;
  const hit: boolean[] = [];
  for (let a = 0; a < n; a++) {
    let k = 0;
    for (let b = 0; b < m; b++) {
      const i = (vertical ? b * img.w + a : a * img.w + b) * 4;
      if (dist(img.data, i, guide) < 120) k++;
    }
    hit.push(k > m * 0.6);
  }
  // ガイドでない区間 = 枠
  const cells: [number, number][] = [];
  let start = -1;
  for (let a = 0; a <= n; a++) {
    const inside = a < n && !hit[a];
    if (inside && start < 0) start = a;
    if (!inside && start >= 0) {
      if (a - start > 4) cells.push([start, a]);
      start = -1;
    }
  }
  return cells;
}

/** 生成されたシートの枠を探す。ガイドが見つからなければ、決めた並びを大きさの比で当てはめる */
export function detectCells(img: Rgba, l: SheetLayout): { rects: Rect[]; detected: boolean } {
  const xs = bands(img, l.guide, true),
    ys = bands(img, l.guide, false);
  if (xs.length === l.cols && ys.length === l.rows) {
    const rects = l.cells.map((_, k): Rect => {
      const [x0, x1] = xs[k % l.cols]!,
        [y0, y1] = ys[Math.floor(k / l.cols)]!;
      return [x0, y0, x1 - x0, y1 - y0];
    });
    return { rects, detected: true };
  }
  const sx = img.w / l.w,
    sy = img.h / l.h;
  const rects = l.cells.map((_, k): Rect => {
    const o = cellOrigin(l, k);
    return [
      Math.round(o.x * sx),
      Math.round(o.y * sy),
      Math.round(l.crop[2] * l.scale * sx),
      Math.round(l.crop[3] * l.scale * sy),
    ];
  });
  return { rects, detected: false };
}

/** RGB の差の二乗和がいちばん小さい色 */
function nearest(colors: number[], r: number, g: number, b: number): number {
  let best = colors[0]!,
    bd = Infinity;
  for (const p of colors) {
    const d = ((p >> 16) - r) ** 2 + (((p >> 8) & 255) - g) ** 2 + ((p & 255) - b) ** 2;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

/**
 * 枠の中を crop の大きさのドットに縮める。各ドットはその区画の中心と、そのまわりの 4 点を見る。
 * パレットがあれば、各点をパレットと背景の色のいちばん近いものに寄せて多数決（背景が勝てば透明）。
 * 無ければ、半分以上が背景なら透明、そうでなければ背景でない点の色の平均。
 */
export function sampleCell(img: Rgba, r: Rect, l: SheetLayout, colors: number[] = []): Rgba {
  const [, , cw, ch] = l.crop;
  const out = blank(cw, ch);
  const BG = -1;
  const labels = [...colors, (l.bg[0] << 16) | (l.bg[1] << 8) | l.bg[2]];
  const cache = new Map<number, number>();
  for (let j = 0; j < ch; j++) {
    for (let i = 0; i < cw; i++) {
      // 区画の中心（重み 3）と、中心から縦横に 1/4 区画ずつ離れた 4 点（重み 1）で決める
      const px0 = r[0] + ((i + 0.5) * r[2]) / cw,
        py0 = r[1] + ((j + 0.5) * r[3]) / ch;
      const qx = r[2] / cw / 4,
        qy = r[3] / ch / 4;
      const votes = new Map<number, number>();
      const sum = [0, 0, 0];
      let n = 0,
        bg = 0;
      for (const [ox, oy, wgt] of [
        [0, 0, 3],
        [-qx, 0, 1],
        [qx, 0, 1],
        [0, -qy, 1],
        [0, qy, 1],
      ] as const) {
        const x = Math.floor(px0 + ox),
          y = Math.floor(py0 + oy);
        if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
        const s = (y * img.w + x) * 4;
        const d = img.data;
        n += wgt;
        let label: number;
        if (d[s + 3]! < 128) label = BG;
        else if (colors.length) {
          const key = (d[s]! << 16) | (d[s + 1]! << 8) | d[s + 2]!;
          let c = cache.get(key);
          if (c === undefined) {
            c = nearest(labels, d[s]!, d[s + 1]!, d[s + 2]!);
            cache.set(key, c);
          }
          label = c === labels.at(-1) ? BG : c;
        } else label = dist(d, s, l.bg) < 120 ? BG : 0;
        votes.set(label, (votes.get(label) ?? 0) + wgt);
        if (label === BG) bg += wgt;
        else for (let c = 0; c < 3; c++) sum[c]! += d[s + c]! * wgt;
      }
      if (!n) continue;
      let px: number[] | null = null;
      if (colors.length) {
        const [win] = [...votes].sort((a, b) => b[1] - a[1])[0]!;
        if (win !== BG) px = [win >> 16, (win >> 8) & 255, win & 255, 255];
      } else if (bg * 2 < n) {
        px = [...sum.map((v) => Math.round(v / (n - bg))), 255];
      }
      if (px) out.data.set(px, (j * cw + i) * 4);
    }
  }
  return out;
}

/** 切り出したドットを (dx, dy) ずらしてベースにいちばん合う所を探す（不透明な範囲と色の一致で比べる） */
export function register(cell: Rgba, ref: Rgba, r = 3): { dx: number; dy: number; miss: number } {
  let best = { dx: 0, dy: 0, miss: Infinity };
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      let miss = 0;
      for (let y = 0; y < ref.h; y++) {
        for (let x = 0; x < ref.w; x++) {
          const sx = x - dx,
            sy = y - dy;
          const i = (y * ref.w + x) * 4;
          const inside = sx >= 0 && sy >= 0 && sx < cell.w && sy < cell.h;
          const s = (sy * cell.w + sx) * 4;
          const a = inside && cell.data[s + 3]! > 0,
            b = ref.data[i + 3]! > 0;
          if (a !== b) miss += 2;
          else if (a && dist(cell.data, s, [ref.data[i]!, ref.data[i + 1]!, ref.data[i + 2]!]) > 60)
            miss++;
        }
      }
      if (
        miss < best.miss ||
        (miss === best.miss && Math.abs(dx) + Math.abs(dy) < Math.abs(best.dx) + Math.abs(best.dy))
      )
        best = { dx, dy, miss };
    }
  }
  return best;
}

export interface CutFrame {
  name: string;
  image: Rgba;
  /** 位置合わせで動かした量（ドット）と、そのときの食い違い */
  dx: number;
  dy: number;
  miss: number;
}

/** 生成されたシートを切り分けて、ベースと同じ大きさ・基準点のコマにする */
export function cutSheet(img: Rgba, l: SheetLayout, base: Rgba, snap = true) {
  const { rects, detected } = detectCells(img, l);
  const [cx, cy, cw, ch] = l.crop;
  const ref = blank(cw, ch);
  for (let y = 0; y < ch; y++) {
    const s = ((cy + y) * base.w + cx) * 4;
    ref.data.set(base.data.subarray(s, s + cw * 4), y * cw * 4);
  }
  const colors = [...palette(base).keys()];
  const frames: CutFrame[] = l.cells.map((name, k) => {
    const cell = sampleCell(img, rects[k]!, l, snap ? colors : []);
    const reg = register(cell, ref);
    const out = blank(l.frame.w, l.frame.h);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const sx = x - reg.dx,
          sy = y - reg.dy;
        if (sx < 0 || sy < 0 || sx >= cw || sy >= ch) continue;
        const s = (sy * cw + sx) * 4;
        out.data.set(cell.data.subarray(s, s + 4), ((cy + y) * l.frame.w + cx + x) * 4);
      }
    }
    return { name, image: out, ...reg };
  });
  return { frames, rects, detected };
}
