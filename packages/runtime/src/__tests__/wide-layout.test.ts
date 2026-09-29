// 16:9 の画面での背景の置き方・スクロールと、部品の寄せ方のテスト
import { describe, expect, it } from 'vitest';
import { BackgroundView } from '../background.ts';
import { EXAMINE_SCROLL_SPEED, examineScrollStep } from '../examine-scroll.ts';
import { TOP, UI } from '../layout.ts';
import { layoutFor, screenWidth, WIDE_W } from '../screen.ts';

const image = (width: number, height: number) => ({ width, height }) as unknown as HTMLImageElement;
const wide = layoutFor(WIDE_W);

describe('layoutFor', () => {
  it('4:3 は元の配置のまま', () => {
    const L = layoutFor(screenWidth('4:3'));
    expect(L.w).toBe(256);
    expect(L.ox).toBe(0);
    expect(L.top.box).toEqual(TOP.box);
    expect(L.ui.recordTab).toEqual(UI.recordTab);
    expect(L.ui.choice(1, 3)).toEqual(UI.choice(1, 3));
    expect(L.ui.invButton(2)).toEqual(UI.invButton(2));
  });

  it('16:9 は 342 幅で、4:3 の枠は左右 43 ドットずつ空けて中央に置く', () => {
    expect(screenWidth('16:9')).toBe(342);
    expect(wide.ox).toBe(43);
    expect(wide.ox * 2 + 256).toBe(342);
  });

  it('16:9 は左・右・中央に寄せる', () => {
    // 幅いっぱい
    expect(wide.top.box).toEqual({ ...TOP.box, w: 342 });
    expect(wide.top.added.w).toBe(342);
    // 右寄せ
    expect(wide.ui.recordTab.x + wide.ui.recordTab.w).toBe(342);
    expect(wide.ui.presentTab.x + wide.ui.presentTab.w).toBe(342);
    expect(wide.ui.examineScroll.x + wide.ui.examineScroll.w).toBe(342);
    expect(wide.top.arrow.x).toBe(TOP.arrow.x + 86);
    // 左寄せ
    expect(wide.ui.invBack).toEqual(UI.invBack);
    // 中央寄せ
    const c = wide.ui.choice(0, 2);
    expect(c.x + c.w / 2).toBe(171);
    expect(wide.ui.invButton(0).x).toBe(UI.invButton(0).x + 43);
    // 法廷記録は 4:3 の枠の座標のまま
    expect(wide.ui.rec).toBe(UI.rec);
  });
});

describe('BackgroundView（16:9）', () => {
  it('4:3 の幅の背景は中央に置き、人物も 4:3 の枠ごと中央へずらす', () => {
    const v = new BackgroundView(wide);
    v.sync('room', image(256, 192), [0, 0]);
    expect(v.x).toBe(0);
    expect(v.origin).toEqual([-43, 0]);
    expect(v.offset).toEqual([43, 0]);
    expect(v.toBackground(43, 10)).toEqual([0, 10]);
    // 左右の黒い所は調べられない
    expect(v.examinable).toEqual({ x: 43, y: 0, w: 256, h: 192 });
    expect(v.slideStep()).toBeNull();
  });

  it('横長の背景は見える幅いっぱいに見せ、4:3 と同じ所を中央に置く（端を越えない）', () => {
    const v = new BackgroundView(wide);
    v.sync('wide', image(512, 192), [128, 0]);
    expect(v.x).toBe(85);
    expect(v.offset).toEqual([43, 0]);
    // 右端（4:3 の 0x100）から始まる背景は、見える幅の右端（170）に詰める
    v.sync('wide2', image(512, 192), [256, 0]);
    expect(v.x).toBe(170);
    // 人物は背景の同じ所に来る（4:3 の画面の中央 128 → 背景の 384 → 画面の 214）
    expect(128 + v.offset[0]).toBe(384 - 170);
    expect(v.examinable).toEqual({ x: 0, y: 0, w: 342, h: 192 });
  });

  it('調べるのスクロールは見える幅の端まで動く', () => {
    const v = new BackgroundView(wide);
    v.sync('wide', image(512, 192), [0, 0]);
    expect(v.slideStep()).toEqual({ x: EXAMINE_SCROLL_SPEED, y: 0 });
    v.slide(null);
    while (v.sliding) v.tick(null);
    expect(v.x).toBe(170);
    expect(v.slideStep()).toEqual({ x: -EXAMINE_SCROLL_SPEED, y: 0 });
  });

  it('見える幅より狭い横長の背景は中央に置いて動かさない', () => {
    const v = new BackgroundView(wide);
    v.sync('mid', image(300, 192), [0, 0]);
    expect(v.origin).toEqual([-21, 0]);
    expect(v.slideStep()).toBeNull();
  });
});

describe('examineScrollStep（16:9）', () => {
  it('0x80・0x100 は 4:3 の枠の位置で比べる', () => {
    const s = EXAMINE_SCROLL_SPEED;
    expect(examineScrollStep({ x: 0x80 - 43, y: 0, w: 768, h: 192 }, 342)).toEqual({ x: -s, y: 0 });
    expect(examineScrollStep({ x: 0x80, y: 0, w: 768, h: 192 }, 342)).toBeNull();
    expect(examineScrollStep({ x: 0, y: 0, w: 342, h: 192 }, 342)).toBeNull();
  });
});
