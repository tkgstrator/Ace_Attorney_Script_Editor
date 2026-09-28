// 「調べる」の間の背景のスクロール（元のゲームの L ボタン）のテスト
import { describe, expect, it } from 'vitest';
import { BackgroundView } from '../background.ts';
import { EXAMINE_SCROLL_SPEED, examineScrollStep } from '../examine-scroll.ts';

const image = (width: number, height: number) => ({ width, height }) as unknown as HTMLImageElement;

/** 動きが終わるまで進める（進めたフレームの数） */
function run(view: BackgroundView, scroll: { x: number; y: number } | null = null): number {
  let n = 0;
  while (view.sliding && n < 1000) {
    view.tick(scroll);
    n++;
  }
  return n;
}

describe('examineScrollStep', () => {
  it('横長: 左端なら右へ、右端・0x80・0x100 なら左へ、それ以外は動かない', () => {
    const s = EXAMINE_SCROLL_SPEED;
    expect(examineScrollStep({ x: 0, y: 0, w: 512, h: 192 })).toEqual({ x: s, y: 0 });
    expect(examineScrollStep({ x: 256, y: 0, w: 512, h: 192 })).toEqual({ x: -s, y: 0 });
    expect(examineScrollStep({ x: 128, y: 0, w: 512, h: 192 })).toEqual({ x: -s, y: 0 });
    expect(examineScrollStep({ x: 128, y: 0, w: 384, h: 192 })).toEqual({ x: -s, y: 0 });
    expect(examineScrollStep({ x: 100, y: 0, w: 512, h: 192 })).toBeNull();
  });

  it('画面の大きさの背景は動かない。縦長は上下', () => {
    expect(examineScrollStep({ x: 0, y: 0, w: 256, h: 192 })).toBeNull();
    expect(examineScrollStep({ x: 0, y: 0, w: 256, h: 384 })).toEqual({ x: 0, y: 6 });
    expect(examineScrollStep({ x: 0, y: 192, w: 256, h: 384 })).toEqual({ x: 0, y: -6 });
  });
});

describe('BackgroundView の調べるときの動き', () => {
  it('右端から左端まで 1 フレーム 6 ドットで動いて止まり、もう一度で右端へ戻る', () => {
    const v = new BackgroundView();
    v.sync('bg12', image(512, 192), [256, 0]);
    expect(v.slide(null)).toBe(true);
    // 256 / 6 = 42.7 → 43 フレーム（最後のフレームは端までの分）
    expect(run(v)).toBe(43);
    expect(v.x).toBe(0);
    // 人物は背景と一緒に動く（背景を変えたときの位置からのずれ）
    expect(v.offset).toEqual([256, 0]);
    expect(v.slide(null)).toBe(true);
    run(v);
    expect(v.x).toBe(256);
  });

  it('動いている間はもう一度動かせない。画面の大きさの背景は動かせない', () => {
    const v = new BackgroundView();
    v.sync('wide', image(512, 192), [0, 0]);
    expect(v.slide(null)).toBe(true);
    expect(v.slide(null)).toBe(false);
    const s = new BackgroundView();
    s.sync('room', image(256, 192), [0, 0]);
    expect(s.slide(null)).toBe(false);
  });

  it('動かす前から続く台本のスクロールには引き戻されない。新しいスクロールは効く', () => {
    const v = new BackgroundView();
    v.sync('wide', image(512, 192), [256, 0]);
    const old = { x: 6, y: 0 };
    v.tick(old);
    expect(v.x).toBe(256);
    v.slide(old);
    run(v, old);
    expect(v.x).toBe(0);
    for (let i = 0; i < 10; i++) v.tick(old);
    expect(v.x).toBe(0);
    v.tick({ x: 6, y: 0 });
    expect(v.x).toBe(6);
  });

  it('背景が変わると最初の位置に戻り、動きも止まる', () => {
    const v = new BackgroundView();
    v.sync('wide', image(512, 192), [0, 0]);
    v.slide(null);
    v.tick(null);
    v.sync('other', image(512, 192), [256, 0]);
    expect(v.sliding).toBe(false);
    expect(v.x).toBe(256);
  });
});
