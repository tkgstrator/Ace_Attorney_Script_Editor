// メイン画面に重ねるボタン（「法廷記録」「ゆさぶる」「つきつける」。DS 版では下画面にあったもの）。
// DS 版の部品の絵（Assets.ui の record / press / presentCross、80×32）があればそれを置き、なければ茶色のタブを描く。
// 絵は図形のタブより大きいので、置く位置と当たりの範囲も絵に合わせて変える。
import { TOP, UI, type Rect } from './layout.ts';
import type { Labels, UiPart } from './options.ts';
import type { Painter } from './painter.ts';

export type TopButton = 'record' | 'press' | 'present';

const PART: Record<TopButton, UiPart> = {
  record: 'record',
  press: 'press',
  present: 'presentCross',
};
/** 絵を置く位置（右上、テキストウィンドウの上に並べる 2 つ）。絵の下の 2 行は透明なので当たりから外す */
const IMAGE_AT: Record<TopButton, Rect> = {
  record: { x: 176, y: 0, w: 80, h: 30 },
  press: { x: 96, y: 112, w: 80, h: 30 },
  present: { x: 176, y: 112, w: 80, h: 30 },
};
const TAB_AT: Record<TopButton, Rect> = {
  record: UI.recordTab,
  press: UI.pressTab,
  present: UI.presentTab,
};

const hasImage = (p: Painter, b: TopButton) => !!p.assets.ui?.(PART[b]);

/** ボタンの当たりの範囲 */
export function topButtonRect(p: Painter, b: TopButton): Rect {
  return hasImage(p, b) ? IMAGE_AT[b] : TAB_AT[b];
}

/** ボタンを描く。enabled が false なら薄く */
export function drawTopButton(p: Painter, b: TopButton, labels: Labels, enabled = true) {
  const img = p.assets.ui?.(PART[b]);
  const ctx = p.ctx;
  ctx.globalAlpha = enabled ? 1 : 0.5;
  if (img) {
    const r = IMAGE_AT[b];
    ctx.drawImage(img, r.x, r.y);
  } else if (b === 'record') {
    p.tab(UI.recordTab, 'bl', labels.record, { small: true, k: 6 });
  } else {
    p.tab(TAB_AT[b], 'tl', b === 'press' ? labels.press : labels.present, { small: true, k: 6 });
  }
  ctx.globalAlpha = 1;
}

/** ライフの「！」の上端。「法廷記録」の絵は右上の 32 ドットを使うので、そのときはその下に並べる */
export function lifeTop(p: Painter): number {
  return hasImage(p, 'record') ? IMAGE_AT.record.y + 34 : TOP.lifeY;
}
