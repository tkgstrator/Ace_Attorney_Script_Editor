// ドット絵向けの減色（quantize.ts）が SPEC.md §2 の色の決まりを守るかを、小さな画像で確かめる。
import { describe, expect, it } from 'vitest';
import { frameStats } from '../checks.ts';
import { compareFrames } from '../diff.ts';
import { patchMouth } from '../mouth.ts';
import { blank, type Rgba } from '../png.ts';
import {
  absorbStrays,
  buildPalette,
  colorsOf,
  histogram,
  is555,
  level5,
  pack,
  quantizeFrames,
  snap555,
} from '../quantize.ts';

function set(img: Rgba, x: number, y: number, c: number[], a = 255) {
  img.data.set([c[0]!, c[1]!, c[2]!, a], (y * img.w + x) * 4);
}

/**
 * 60×60 の人物もどき。輪郭は暗い紺、顔は肌色のグラデーション、体は青のグラデーション、
 * 端は半透明（縮小で混ざった状態をまねる）。色は 15 よりずっと多い
 */
function person(): Rgba {
  const img = blank(60, 60);
  for (let y = 4; y < 60; y++) {
    for (let x = 10; x < 50; x++) {
      const edge = x === 10 || x === 49 || y === 4;
      const t = (x * 7 + y * 3) % 40;
      const c = edge
        ? [30 + (y % 5), 24, 60 + (x % 7)]
        : y < 30
          ? [230 - t, 190 - t, 150 - (t >> 1)]
          : [40 + (t >> 1), 60 + t, 150 + t];
      set(img, x, y, c, edge && y % 3 === 0 ? 140 : 255);
    }
  }
  // 口（閉じた口は顔の中の短い線）
  for (let x = 26; x < 34; x++) set(img, x, 20, [120, 50, 50]);
  return img;
}

/** 口を開けた絵: 口のまわり（x 24〜35, y 18〜24）だけ変える */
function talking(): Rgba {
  const img = person();
  for (let y = 18; y < 25; y++) for (let x = 25; x < 35; x++) set(img, x, y, [140, 20, 30]);
  return img;
}

describe('15 ビット色', () => {
  it('丸めた色は DS の段（c × 255 ÷ 31 の切り捨て）に乗る', () => {
    for (let v = 0; v < 256; v += 7) expect(is555(snap555(pack(v, 255 - v, v >> 1)))).toBe(true);
    expect(level5(31)).toBe(255);
    expect(level5(1)).toBe(8);
    expect(is555(pack(9, 0, 0))).toBe(false);
  });
});

describe('パレット', () => {
  it('色の数を守り、同じ入力なら同じパレット', () => {
    const hist = histogram([person()]);
    expect(hist.size).toBeGreaterThan(15);
    const a = buildPalette(hist, { colors: 15 });
    expect(a.length).toBe(15);
    expect(a.every(is555)).toBe(true);
    expect(buildPalette(hist, { colors: 15 })).toEqual(a);
  });

  it('固定した色は必ず入る', () => {
    const fixed = snap555(pack(10, 200, 10));
    expect(buildPalette(histogram([person()]), { colors: 15, fixed: [fixed] })).toContain(fixed);
  });
});

describe('quantizeFrames', () => {
  const { frames, palette } = quantizeFrames([person(), talking()], { colors: 15 }, [undefined, 0]);

  it('1 コマ 15 色以下・15 ビット色・透明度は 0 か 255', () => {
    for (const f of frames) {
      const s = frameStats(f);
      expect(s.colors).toBeLessThanOrEqual(15);
      expect(s.rgb555).toBe(1);
      expect(s.semiAlpha).toBe(0);
    }
  });

  it('全コマで 1 枚のパレットを共有する（全コマの色を合わせても 15 色）', () => {
    expect(palette.length).toBeLessThanOrEqual(15);
    const all = new Set(frames.flatMap((f) => [...colorsOf(f)]));
    expect(all.size).toBeLessThanOrEqual(15);
    for (const c of all) expect(palette).toContain(c);
  });

  it('輪郭の暗い色が残り、輪郭の点はいちばん暗い色で描かれる', () => {
    const s = frameStats(frames[0]!);
    expect(s.outlineDark).toBeGreaterThan(0.6);
  });

  it('差分コマはベースで使った色だけで描く', () => {
    const baseColors = colorsOf(frames[0]!);
    for (const c of colorsOf(frames[1]!)) expect(baseColors.has(c)).toBe(true);
  });

  it('口のまわりだけ差し替えると、範囲の外の変化 0・新しい色 0', () => {
    const [base, talk] = frames as [Rgba, Rgba];
    const patched = { ...talk, data: patchMouth(base, talk) };
    const d = compareFrames(base, patched, 'talk', [[23, 16, 14, 11]]);
    expect(d.outside).toBe(0);
    expect(d.newColorPx).toBe(0);
    expect(d.inside).toBeGreaterThan(0);
  });
});

describe('absorbStrays', () => {
  it('2 色の中間の孤立点は近い方に吸収し、まわりより明るいハイライトは残す', () => {
    const img = blank(5, 3);
    for (let x = 0; x < 5; x++) {
      for (let y = 0; y < 3; y++) set(img, x, y, x < 2 ? [0, 0, 0] : [200, 200, 200]);
    }
    set(img, 2, 1, [60, 60, 60]); // 黒と灰の間（黒に近い）
    set(img, 3, 1, [255, 255, 255]); // 灰の中のハイライト（どの隣よりも明るい）
    const r = absorbStrays(img);
    const px = (x: number, y: number) => [
      ...r.img.data.subarray((y * 5 + x) * 4, (y * 5 + x) * 4 + 3),
    ];
    expect(px(2, 1)).toEqual([0, 0, 0]);
    expect(px(3, 1)).toEqual([255, 255, 255]);
  });
});
