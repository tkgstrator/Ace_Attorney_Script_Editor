// 4:3 の画面に重ねるボタン（「法廷記録」「ゆさぶる」「つきつける」。DS 版では下画面にあったもの。16:9 では右の欄に出す）。
// DS 版の部品の絵（Assets.ui の record / press / presentCross、80×32）があればそれを置き、なければ茶色のタブを描く。
// 絵は図形のタブより大きいので、置く位置と当たりの範囲も絵に合わせて変える。どれも画面の右に寄せる。
import { type Rect, TOP, UI } from './layout.ts';
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

const hasImage = (p: Painter, b: TopButton) => !!p.assets.ui?.(PART[b]);

/** ボタンの当たりの範囲 */
export function topButtonRect(p: Painter, b: TopButton): Rect {
  return hasImage(p, b) ? IMAGE_AT[b] : tabAt(b);
}

function tabAt(b: TopButton): Rect {
  return b === 'record' ? UI.recordTab : b === 'press' ? UI.pressTab : UI.presentTab;
}

/** ボタンを描く。enabled が false なら薄く */
export function drawTopButton(p: Painter, b: TopButton, labels: Labels, enabled = true) {
  p.button(
    topButtonRect(p, b),
    () => {
      const img = p.assets.ui?.(PART[b]);
      const ctx = p.ctx;
      ctx.globalAlpha = enabled ? 1 : 0.5;
      if (img) {
        const r = IMAGE_AT[b];
        ctx.drawImage(img, r.x, r.y);
      } else if (b === 'record') {
        p.tab(tabAt(b), 'bl', labels.record, { small: true, k: 6 });
      } else {
        p.tab(tabAt(b), 'tl', b === 'press' ? labels.press : labels.present, { small: true, k: 6 });
      }
      ctx.globalAlpha = 1;
    },
    enabled,
    b === 'record' ? labels.record : b === 'press' ? labels.press : labels.present,
  );
}

/**
 * ライフの「！」の上端。4:3 で「法廷記録」の絵を右上に置くときは、その 32 ドットの下に並べる。
 * 16:9 はボタンを画面に重ねないので、DS 版と同じ位置
 */
export function lifeTop(p: Painter): number {
  return !p.layout.panel && hasImage(p, 'record') ? IMAGE_AT.record.y + 34 : TOP.lifeY;
}
