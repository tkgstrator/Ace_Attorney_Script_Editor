// 法廷記録の画面の部品（DS 版の下画面から写した形と色）。
// 背景 → 板・枠・アイコン・文字 → 横じま → 上下の帯とボタン、の順に重ねる。
// 横じまは、DS 版では画面の中ほど（y 32〜173）の 4 行ごとに 1 行、明るい行が重なっている。
import { REC_COLORS as C, SCREEN_W, UI, type Rect } from './layout.ts';
import type { UiPart } from './options.ts';
import type { Painter } from './painter.ts';
import { shapeRuns, spansOf, type Run, type Shape, type ShapeStyle } from './shape.ts';

const cache = new Map<string, Run[]>();

/** 横の並びを塗る（計算した結果は名前ごとに覚えておく） */
function runs(p: Painter, key: string, make: () => Run[]) {
  let rs = cache.get(key);
  if (!rs) {
    rs = make();
    cache.set(key, rs);
  }
  for (const r of rs) p.rect(r.x, r.y, r.w, 1, r.color);
}

/** 形を塗る */
const paint = (p: Painter, key: string, shape: () => Shape, style: ShapeStyle) =>
  runs(p, key, () => shapeRuns(shape(), style));

/** 茶色のボタン（白 → 濃い灰の縁、上の内側に明るい線） */
const BUTTON: ShapeStyle = {
  edges: [C.btnOuter, C.btnEdge],
  fill: C.btnFill,
  inner: {
    top: C.btnLight,
    bottom: C.btnDark,
    left: C.btnSide,
    right: C.btnSideR,
    slant: C.btnDark,
  },
};
/** 明るい灰色の帯（縁は 1 ドットの灰色、斜めの辺には中間の色） */
const PLATE: ShapeStyle = {
  edges: [C.plateEdge],
  fill: C.plate,
  aa: C.plateAa,
  screenInside: true,
};

// ---- 形 --------------------------------------------------------------------------

/** 上の帯の、各列の下端（この行が縁）。見出しの所は上がり、タブ・ボタンの所は下がる */
function topPlateBottom(x: number, present: boolean): number {
  let b = x <= 64 ? 9 : x <= 71 ? 10 + (x - 65) : 17;
  if (x >= 177) b = Math.max(b, Math.min(31, x - 159));
  if (present && x >= 89 && x <= 166) b = Math.max(b, Math.min(31, x - 71, 184 - x));
  return b;
}

/** 下の帯の、各列の上端。「もどる」の所だけ上に伸びる */
const bottomPlateTop = (x: number) => (x <= 65 ? 160 : x <= 78 ? x + 95 : 174);

const switchTab = (): Shape =>
  spansOf(0, 29, (y) =>
    y === 0 ? [178, 254] : y === 29 ? [191, 254] : [y <= 15 ? 177 : y + 162, 255],
  );
const presentBtn = (): Shape =>
  spansOf(0, 29, (y) =>
    y === 0 ? [90, 165] : y <= 15 ? [89, 166] : [89 + (y - 15), 166 - (y - 15)],
  );
const backBtn = (): Shape =>
  spansOf(162, 191, (y) =>
    y === 162 ? [1, 64] : y === 191 ? [1, 77] : [0, Math.min(65 + (y - 163), 78)],
  );

/** 赤い縦長のボタン（一覧のページ送り・詳細の前後）。角は 2 段で丸める。right は右端に置くもの（左右が逆） */
function sideBar(r: Rect, right: boolean): Shape {
  const [a, b] = right ? [1, 2] : [2, 1];
  return spansOf(r.y, r.y + r.h - 1, (y) => {
    const k = Math.min(y - r.y, r.y + r.h - 1 - y);
    if (k === 0) return [r.x + a, r.x + r.w - 1 - b];
    if (k === 1) return [r.x + a - 1, r.x + r.w - b];
    return [r.x, r.x + r.w - 1];
  });
}

// ---- 部品 ------------------------------------------------------------------------

/** 背景（不透明）。くすんだ色で塗り、絵があれば重ねる（絵の透明な所は塗った色になる） */
export function background(p: Painter) {
  p.rect(0, 0, SCREEN_W, 192, C.bgMid);
  p.rect(0, 96, SCREEN_W, 96, C.bgLow);
  const img = p.assets.ui?.('recordBackground');
  if (img) p.ctx.drawImage(img, 0, 0, SCREEN_W, 192);
}

/** 横じま。y 32〜173 の、4 行ごとの 1 行を明るくする */
export function stripes(p: Painter) {
  const ctx = p.ctx;
  ctx.globalCompositeOperation = 'lighter';
  for (let y = 34; y <= 173; y += 4) p.rect(0, y, SCREEN_W, 1, C.stripe);
  ctx.globalCompositeOperation = 'source-over';
}

/** 上の帯と、見出しの暗い帯（文字は含まない） */
export function topBar(p: Painter, present: boolean) {
  // 暗い帯は、上の帯の縁から 2 行が濃く、次の 1 行と一番下の行が少し濃い
  runs(p, 'bar', () => {
    const out: Run[] = [];
    for (let y = 10; y <= 31; y++) {
      for (let x = 0; x < SCREEN_W; x++) {
        const dy = y - topPlateBottom(x, false);
        if (dy <= 0) continue;
        const color = y === 31 || dy === 3 ? C.barEdge : dy <= 2 ? C.barDark : C.bar;
        const last = out[out.length - 1];
        if (last && last.y === y && last.x + last.w === x && last.color === color) last.w++;
        else out.push({ x, y, w: 1, color });
      }
    }
    return out;
  });
  paint(
    p,
    `plateTop${present}`,
    () => ({
      x0: 0,
      y0: 0,
      x1: SCREEN_W - 1,
      y1: 31,
      inside: (x, y) => y <= topPlateBottom(x, present),
    }),
    PLATE,
  );
}

/** 下の帯 */
export function bottomBar(p: Painter) {
  paint(
    p,
    'plateBottom',
    () => ({ x0: 0, y0: 160, x1: SCREEN_W - 1, y1: 191, inside: (x, y) => y >= bottomPlateTop(x) }),
    PLATE,
  );
}

export const drawSwitchTab = (p: Painter) => paint(p, 'switchTab', switchTab, BUTTON);
export const drawBackButton = (p: Painter) =>
  paint(p, 'back', backBtn, {
    ...BUTTON,
    inner: { ...BUTTON.inner, right: C.btnSide, slant: C.btnLight2 },
  });

/** 「つきつける」のボタン。後ろに薄い ▲ の印 */
export function drawPresentButton(p: Painter) {
  paint(p, 'present', presentBtn, { ...BUTTON, inner: { ...BUTTON.inner, left: C.btnSideR } });
  for (let y = 4; y <= 25; y++) {
    const k = Math.round(((y - 4) * 2) / 3);
    p.rect(127 - k, y, k * 2 + 1, 1, C.btnLight);
  }
}

/** 赤い縦長のボタンと、その中の白い矢印（arrow が false なら矢印なし） */
export function sideButton(p: Painter, r: Rect, dir: 'left' | 'right', arrow = true) {
  const right = r.x + r.w / 2 > SCREEN_W / 2;
  paint(p, `side${r.x},${r.y},${r.h}`, () => sideBar(r, right), {
    edges: [C.btnOuter, C.sideEdge],
    fill: C.sideFill,
    inner: { top: C.btnLight, bottom: C.sideDark, left: C.sideInner, right: C.sideInner },
  });
  if (!arrow) return;
  // 高さ 13、幅 7 の三角形。先の側の 1 ドットは中間の色
  const top = r.y + r.h / 2 - 6;
  for (let i = 0; i <= 12; i++) {
    const k = 6 - Math.abs(i - 6);
    if (dir === 'left') {
      const xr = r.x + 10;
      p.rect(xr - k + 1, top + i, k, 1, '#ffffff');
      p.rect(xr - k, top + i, 1, 1, C.arrowAa);
    } else {
      const xl = r.x + 5;
      p.rect(xl, top + i, k, 1, '#ffffff');
      p.rect(xl + k, top + i, 1, 1, C.arrowAa);
    }
  }
}

/**
 * 白と灰色の 2 重の枠（名前の帯・選んだ項目・詳細の窓）。r は外側の白い枠で、灰色の枠は右下に 1 ドットずれて重なる。
 * 中は r の内側 2 ドットから
 */
export function frame(p: Painter, r: Rect) {
  const { x, y, w, h } = r;
  p.rect(x + 1, y + 1, w, 1, C.frameGrey);
  p.rect(x + w, y + 1, 1, h - 1, C.frameGrey);
  p.rect(x + 1, y + 2, 1, h - 1, C.frameGrey);
  p.rect(x + 1, y + h, w - 1, 1, C.frameShadow);
  p.rect(x + 1, y, w - 1, 1, C.frameWhite);
  p.rect(x, y + 1, 1, h - 1, C.frameWhite);
  p.rect(x + w - 1, y, 1, h, C.frameWhite);
  p.rect(x, y + h - 1, w, 1, C.frameWhite);
  for (const [cx, cy] of [
    [x + 1, y + 1],
    [x + w - 1, y + 1],
    [x + 1, y + h - 1],
    [x + w - 1, y + h - 1],
  ] as const)
    p.rect(cx, cy, 1, 1, C.frameCorner);
}

/** 一覧の空きのマス（くぼんだ枠） */
export function emptyCell(p: Painter, c: Rect) {
  p.rect(c.x, c.y, c.w, 1, C.panelEdge);
  p.rect(c.x, c.y + 1, 1, c.h - 2, C.panelEdge);
  p.rect(c.x + 1, c.y + c.h - 1, c.w - 2, 1, C.cellLight);
  p.rect(c.x + c.w - 1, c.y + 1, 1, c.h - 2, C.cellMid);
  p.rect(c.x, c.y + c.h - 1, 1, 1, C.cellMid);
  p.rect(c.x + c.w - 1, c.y + c.h - 1, 1, 1, C.cellCorner);
}

/** 詳細の上下の、16 ドットごとに区切った明るい帯（6 行） */
export function frieze(p: Painter, y: number) {
  const rows: [string, string, string][] = [
    [C.friezeHi, C.friezeLineTop, C.friezeTop],
    ...Array.from(
      { length: 4 },
      () => [C.friezeHi2, C.friezeLine, C.frieze] as [string, string, string],
    ),
    [C.friezeHi2, C.friezeLineTop, C.friezeBottom],
  ];
  rows.forEach(([hi, line, base], i) => {
    p.rect(0, y + i, SCREEN_W, 1, base);
    for (let x = 0; x < SCREEN_W; x += 16) {
      p.rect(x, y + i, 1, 1, hi);
      p.rect(x + 1, y + i, 1, 1, line);
    }
  });
}

/** 一覧の木の板 */
export function panel(p: Painter) {
  const r = UI.rec.panel;
  p.rect(r.x, r.y, r.w, r.h, C.panelEdge);
  p.rect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, C.panel);
}

// ---- DS 版の部品の絵（Assets.ui）があるとき ----------------------------------------

/** 部品の絵を (x, y) に置く。flipX / flipY で反転、wide で横 2 倍。絵がなければ何もせず false */
export function putUi(
  p: Painter,
  part: UiPart,
  x: number,
  y: number,
  o: { flipX?: boolean; flipY?: boolean; wide?: boolean } = {},
): boolean {
  const img = p.assets.ui?.(part);
  if (!img) return false;
  const { width: w, height: h } = img as { width: number; height: number };
  const dw = o.wide ? w * 2 : w;
  const ctx = p.ctx;
  ctx.save();
  ctx.translate(o.flipX ? x + dw : x, o.flipY ? y + h : y);
  ctx.scale(o.flipX ? -1 : 1, o.flipY ? -1 : 1);
  ctx.drawImage(img, 0, 0, dw, h);
  ctx.restore();
  return true;
}

/**
 * 上の帯の絵を、図形で描いた帯の上に重ねる（DS 版の置き方: 部品 frameBar を横 2 倍で、題の後ろは y −22、
 * その右は y −14。つきつけるときは題の後ろだけ）
 */
export function uiTopPlate(p: Painter, present: boolean) {
  for (const x of [0, 32]) putUi(p, 'frameBar', x, -22, { wide: true });
  if (!present) for (const x of [80, 112, 144]) putUi(p, 'frameBar', x, -14, { wide: true });
}

/** 下の帯の絵（上下反転して 16 ドットごと。「もどる」の後ろは y 160、その右は y 174、間に斜めの角） */
export function uiBottomPlate(p: Painter) {
  for (let x = 0; x < 64; x += 16) putUi(p, 'frameBar', x, 160, { flipY: true });
  putUi(p, 'frameCorner', 64, 160, { flipX: true, flipY: true });
  for (let x = 80; x < SCREEN_W; x += 16) putUi(p, 'frameBar', x, 174, { flipY: true });
}

/** 左上の題の札（「証拠品」または「人物」＋「ファイル」＋右端の斜め）。絵がそろっていなければ false */
export function uiTitle(p: Painter, tab: 'evidence' | 'profile'): boolean {
  const head: UiPart = tab === 'evidence' ? 'titleEvidence' : 'titleProfile';
  if (!p.assets.ui?.(head) || !p.assets.ui('titleFile') || !p.assets.ui('titleEnd')) return false;
  putUi(p, head, 0, 0);
  putUi(p, 'titleFile', 32, 0);
  putUi(p, 'titleEnd', 64, 0);
  return true;
}
