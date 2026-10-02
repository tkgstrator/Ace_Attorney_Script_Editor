// 画面の幅（4:3 / 16:9）の配置、16:9 の右の欄のボタンの置き方、背景の置き方・スクロールのテスト
import { describe, expect, it } from 'vitest';
import { BackgroundView } from '../background.ts';
import { EXAMINE_SCROLL_SPEED } from '../examine-scroll.ts';
import type { Rect } from '../layout.ts';
import { buttonRect } from '../panel.ts';
import { layoutFor, PANEL_W, screenWidth, WIDE_W } from '../screen.ts';

const image = (width: number, height: number) => ({ width, height }) as unknown as HTMLImageElement;
const inside = (r: Rect, outer: Rect) =>
  r.x >= outer.x &&
  r.y >= outer.y &&
  r.x + r.w <= outer.x + outer.w &&
  r.y + r.h <= outer.y + outer.h;
const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('layoutFor', () => {
  it('4:3 は 256×192 で、右の欄は無い', () => {
    const L = layoutFor(screenWidth('4:3'));
    expect(L).toEqual({ w: 256, h: 192, panel: null });
  });

  it('16:9 は 342 幅で、左の 256×192 の右に 86 ドットの欄を置く', () => {
    const L = layoutFor(screenWidth('16:9'));
    expect(WIDE_W).toBe(342);
    expect(L.w).toBe(342);
    expect(L.panel).toEqual({ x: 256, y: 0, w: PANEL_W, h: 192 });
  });
});

describe('右の欄のボタン', () => {
  const panel = layoutFor(WIDE_W).panel;
  if (!panel) throw new Error('16:9 には右の欄がある');

  it('5 段とも DS 版と同じ 80×32 で、欄の中に重ならずに並ぶ', () => {
    const slots = [0, 1, 2, 3, 4].map((slot) => buttonRect(panel, { slot }));
    for (const [i, r] of slots.entries()) {
      expect(r.w).toBe(80);
      expect(r.h).toBe(32);
      expect(inside(r, panel)).toBe(true);
      for (const other of slots.slice(i + 1)) expect(overlaps(r, other)).toBe(false);
    }
  });

  it('大きなボタンは段をまたいでのび、左右半分のボタンは重ならない', () => {
    const big = buttonRect(panel, { slot: [1, 4] });
    expect(big.y).toBe(buttonRect(panel, { slot: 1 }).y);
    expect(big.y + big.h).toBe(buttonRect(panel, { slot: 4 }).y + 32);
    expect(inside(big, panel)).toBe(true);
    const left = buttonRect(panel, { slot: [3, 4], half: 'left' });
    const right = buttonRect(panel, { slot: [3, 4], half: 'right' });
    expect(overlaps(left, right)).toBe(false);
    expect(left.x).toBe(big.x);
    expect(right.x + right.w).toBe(big.x + big.w);
  });
});

describe('BackgroundView', () => {
  it('画面の幅の背景は左上に置き、人物はずらさない', () => {
    const v = new BackgroundView();
    v.sync('room', image(256, 192), [0, 0]);
    expect(v.origin).toEqual([0, 0]);
    expect(v.offset).toEqual([0, 0]);
    expect(v.toBackground(10, 20)).toEqual([10, 20]);
    expect(v.slideStep()).toBeNull();
  });

  it('横長の背景は最初の位置から見せ、調べるのスクロールで端まで動く。人物も一緒に動く', () => {
    const v = new BackgroundView();
    v.sync('wide', image(512, 192), [0, 0]);
    expect(v.slideStep()).toEqual({ x: EXAMINE_SCROLL_SPEED, y: 0 });
    v.slide(null);
    while (v.sliding) v.tick(null);
    expect(v.x).toBe(256);
    expect(v.offset).toEqual([-256, 0]);
    expect(v.toBackground(0, 0)).toEqual([256, 0]);
    expect(v.slideStep()).toEqual({ x: -EXAMINE_SCROLL_SPEED, y: 0 });
  });

  it('台本のスクロールは端で止まる', () => {
    const v = new BackgroundView();
    v.sync('wide', image(300, 192), [0, 0]);
    for (let i = 0; i < 20; i++) v.tick({ x: 6, y: 0 });
    expect(v.x).toBe(44);
  });
});
