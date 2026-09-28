// 立ち絵のチェッカーの判定を、小さな画像を作って確かめる。
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkCharacter } from '../check.ts';
import { detectShift, estimateMask, frameStats, isShifted, shiftImage } from '../checks.ts';
import { compareFrames, fixFrame } from '../diff.ts';
import { blank, decodePng, encodePng, type Rgba, writePng } from '../png.ts';
import { roleOf } from '../spec.ts';

const OUTLINE = [30, 20, 40],
  SKIN = [240, 200, 170],
  SUIT = [40, 60, 160],
  MOUTH = [150, 40, 40];

function set(img: Rgba, x: number, y: number, c: number[], a = 255) {
  img.data.set([c[0]!, c[1]!, c[2]!, a], (y * img.w + x) * 4);
}

/** 40×40 の人物もどき: 輪郭つきの顔（上）と体（下） */
function person(): Rgba {
  const img = blank(40, 40);
  for (let y = 4; y < 40; y++) {
    for (let x = 8; x < 32; x++) {
      const edge = x === 8 || x === 31 || y === 4;
      set(img, x, y, edge ? OUTLINE : y < 20 ? SKIN : SUIT);
    }
  }
  return img;
}

const copy = (img: Rgba): Rgba => ({ ...img, data: img.data.slice() });

describe('png', () => {
  it('書いて読むと同じ', () => {
    const img = person();
    set(img, 0, 0, [1, 2, 3], 128);
    expect(decodePng(encodePng(img))).toEqual(img);
  });
});

describe('frameStats', () => {
  it('半透明の点と色の数を数える', () => {
    const img = person();
    set(img, 10, 10, SKIN, 128);
    const s = frameStats(img);
    expect(s.semiAlpha).toBe(1);
    expect(s.colors).toBe(3);
    expect(s.aaSuspect).toBe(0);
    expect(s.outlineDark).toBe(1);
  });
  it('2 色のあいだの色の孤立した点をアンチエイリアスの疑いとする', () => {
    const img = person();
    // 肌と服の境目に中間色の点を置く
    set(img, 15, 20, [140, 130, 165]);
    set(img, 15, 19, SKIN);
    set(img, 15, 21, SUIT);
    expect(frameStats(img).aaSuspect).toBeGreaterThan(0);
  });
});

describe('compareFrames', () => {
  const mask: [number, number, number, number][] = [[16, 12, 8, 4]];
  it('範囲の中だけ変えた口パクは通る', () => {
    const base = person(),
      talk = copy(base);
    for (let x = 18; x < 22; x++) set(talk, x, 14, OUTLINE);
    const d = compareFrames(base, talk, 'talk', mask);
    expect(d.inside).toBe(4);
    expect(d.outside).toBe(0);
    expect(d.shifted).toBe(false);
    expect(d.newColorPx).toBe(0);
  });
  it('範囲の外の変化とベースにない色を数える', () => {
    const base = person(),
      talk = copy(base);
    set(talk, 18, 14, MOUTH);
    set(talk, 12, 30, SKIN);
    set(talk, 13, 30, [41, 60, 160]);
    const d = compareFrames(base, talk, 'talk', mask);
    expect(d.outside).toBe(2);
    expect(d.outsideBox).toEqual([12, 30, 2, 1]);
    expect(d.newColorPx).toBe(2);
  });
  it('範囲が無ければ違いの集まりから推定する', () => {
    const base = person(),
      talk = copy(base);
    for (let x = 18; x < 22; x++) set(talk, x, 14, OUTLINE);
    const d = compareFrames(base, talk, 'talk');
    expect(d.maskSource).toBe('estimated');
    expect(d.masks).toEqual([[17, 13, 6, 3]]);
    expect(d.outside).toBe(0);
  });
  it('全体が 1 ドットずれたら、ずれとして見つける', () => {
    const base = person();
    const moved = shiftImage(base, 1, 0);
    const s = detectShift(base, moved);
    expect([s.dx, s.dy]).toEqual([-1, 0]);
    expect(isShifted(s)).toBeTruthy();
    expect(compareFrames(base, moved, 'talk', mask).shifted).toBe(true);
  });
});

describe('estimateMask', () => {
  it('上半分で違いのいちばん多い所を囲む', () => {
    const ch = new Uint8Array(40 * 40);
    for (const [x, y] of [
      [20, 10],
      [22, 11],
      [2, 2],
    ])
      ch[y! * 40 + x!] = 1;
    expect(estimateMask(ch, 40, 40, { w: 8, h: 4 }, 1)).toEqual([19, 9, 5, 4]);
  });
});

describe('fixFrame', () => {
  it('範囲の外はベースに戻し、範囲の中はベースの色に寄せる', () => {
    const base = person(),
      talk = copy(base);
    set(talk, 18, 14, [35, 22, 45]); // 輪郭の色に近い新しい色
    set(talk, 12, 30, SKIN); // 範囲の外
    const d = compareFrames(base, talk, 'talk', [[16, 12, 8, 4]]);
    const fixed = fixFrame(base, talk, d);
    const again = compareFrames(base, fixed, 'talk', [[16, 12, 8, 4]]);
    expect(again.outside).toBe(0);
    expect(again.newColorPx).toBe(0);
    expect(again.inside).toBe(1);
  });
});

describe('roleOf', () => {
  it('ファイル名からコマの種類とベースを決める', () => {
    expect(roleOf('a', 'a')).toEqual({ role: 'base', base: 'a' });
    expect(roleOf('a', 'a-talk')).toEqual({ role: 'talk', base: 'a' });
    expect(roleOf('a', 'a-blink2')).toEqual({ role: 'blink', base: 'a' });
    expect(roleOf('a', 'a-think-talk1')).toEqual({ role: 'talk', base: 'a-think' });
    expect(roleOf('a', 'a-think')).toEqual({ role: 'pose', base: 'a' });
    expect(roleOf('a', 'ab-talk')).toBeNull();
  });
});

describe('checkCharacter', () => {
  it('ファイルの組を確かめ、失敗を返す', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sprite-check-'));
    const base = blank(256, 192);
    const p = person();
    for (let y = 0; y < 40; y++) {
      for (let x = 0; x < 40; x++) {
        const s = (y * 40 + x) * 4;
        base.data.set(p.data.subarray(s, s + 4), ((y + 152) * 256 + x + 108) * 4);
      }
    }
    const talk = copy(base);
    set(talk, 128, 166, OUTLINE); // 口
    writePng(join(dir, 'x.png'), base);
    writePng(join(dir, 'x-talk.png'), talk);
    const opts = { dir, out: join(dir, 'out'), fix: true, tolerance: 0, maxOutside: 0 };
    const ok = checkCharacter('x', { ...opts, masks: { talk: [[124, 164, 8, 4]] } });
    expect(ok.frames.map((f) => f.errors)).toEqual([[], []]);
    expect(ok.ok).toBe(true);
    set(talk, 110, 185, SKIN); // 体の色が変わった
    writePng(join(dir, 'x-talk.png'), talk);
    const ng = checkCharacter('x', { ...opts, masks: { talk: [[124, 164, 8, 4]] } });
    expect(ng.ok).toBe(false);
    expect(ng.frames[1]!.diff!.outside).toBe(1);
    expect(ng.frames[1]!.fixed).toBeDefined();
  });
});
