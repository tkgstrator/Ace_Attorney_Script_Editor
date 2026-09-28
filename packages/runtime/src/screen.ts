// 画面の幅（4:3 / 16:9）と、幅に合わせた部品の配置。
// 配置の元の値（layout.ts の TOP・UI）は DS 版の 256 ドット幅の画面で測ったもの。広い画面では、部品ごとに
// 画面の左・右・中央のどこに寄せるかを決めて、x をずらす（左寄せはそのまま、右寄せは広がった分、中央寄せはその半分）。
// 法廷記録（UI.rec）・背景・立ち絵は、256 ドット幅の枠（4:3 の枠）を画面の中央に置いて、その中の座標で描く。
import { type Rect, SCREEN_H, SCREEN_W, TOP, UI } from './layout.ts';

export type Aspect = '4:3' | '16:9';

/**
 * 16:9 の画面の幅（ドット）。192 × 16 / 9 ≈ 341.3 を偶数に切り上げた 342。
 * 4:3 の枠を中央に置くと、左右に 43 ドットずつ（中央は x 171）で、どちらも整数になる
 */
export const WIDE_W = 342;

/** 画面の幅（ドット） */
export const screenWidth = (aspect: Aspect = '4:3'): number =>
  aspect === '16:9' ? WIDE_W : SCREEN_W;

export interface Layout {
  /** 画面の大きさ（ドット） */
  w: number;
  h: number;
  /** 4:3 の枠（256 ドット幅。DS 版の座標）を画面の中央に置いたときの左端。4:3 なら 0 */
  ox: number;
  /** 右寄せの部品をずらす量（画面の幅 − 256）。4:3 なら 0 */
  dx: number;
  /** メイン画面の配置（TOP と同じ形。テキストウィンドウと入手の窓は画面の幅いっぱい） */
  top: typeof TOP;
  /** 操作部品の配置（UI と同じ形。法廷記録の rec は 4:3 の枠の中の座標のまま） */
  ui: typeof UI;
}

const cache = new Map<number, Layout>();

/** 幅 w の画面の配置 */
export function layoutFor(w: number = SCREEN_W): Layout {
  const hit = cache.get(w);
  if (hit) return hit;
  const dx = w - SCREEN_W;
  const ox = Math.floor(dx / 2);
  const right = (r: Rect): Rect => ({ ...r, x: r.x + dx });
  const center = (r: Rect): Rect => ({ ...r, x: r.x + ox });
  const layout: Layout = {
    w,
    h: SCREEN_H,
    ox,
    dx,
    top: {
      ...TOP,
      // テキストウィンドウ・入手の窓: 画面の幅いっぱい。本文と名札は左寄せ、文字送りの ▶ は右寄せ
      box: { ...TOP.box, w: TOP.box.w + dx },
      added: { ...TOP.added, w: TOP.added.w + dx },
      arrow: { ...TOP.arrow, x: TOP.arrow.x + dx },
    },
    ui: {
      ...UI,
      // 右上の「法廷記録」、右寄せの「ゆさぶる」「つきつける」
      recordTab: right(UI.recordTab),
      pressTab: right(UI.pressTab),
      presentTab: right(UI.presentTab),
      // 選択肢・探偵メニューのボタンは中央寄せ
      choice: (i, n) => center(UI.choice(i, n)),
      invButton: (i) => center(UI.invButton(i)),
      // 「もどる」は左下のまま。背景を動かすボタン・絵の早戻し・早送りは右下
      examineScroll: right(UI.examineScroll),
      pickPrev: right(UI.pickPrev),
      pickNext: right(UI.pickNext),
    },
  };
  cache.set(w, layout);
  return layout;
}

/** 右寄せの部品の矩形 */
export const alignRight = (L: Layout, r: Rect): Rect => ({ ...r, x: r.x + L.dx });
