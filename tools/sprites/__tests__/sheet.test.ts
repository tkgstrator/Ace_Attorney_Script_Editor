// スプライトシートの作成と切り分けを、小さな画像で確かめる。
import { describe, expect, it } from 'vitest';
import { changedMask } from '../checks.ts';
import { blank, type Rgba } from '../png.ts';
import { cellOrigin, cutSheet, drawSheet, planSheet } from '../sheet-layout.ts';

const COLORS = [
  [30, 20, 40],
  [240, 200, 170],
  [40, 60, 160],
];

/** 60×60 のキャンバスに 20×30 の人物もどき（3 色の横じま） */
function base(): Rgba {
  const img = blank(60, 60);
  for (let y = 20; y < 50; y++) {
    for (let x = 20; x < 40; x++)
      img.data.set([...COLORS[Math.floor(y / 4) % 3]!, 255], (y * 60 + x) * 4);
  }
  return img;
}

/** 最近傍で任意の大きさに変える（生成モデルが大きさを変えて返した場合のまね） */
function resize(img: Rgba, w: number, h: number): Rgba {
  const out = blank(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = (Math.floor((y * img.h) / h) * img.w + Math.floor((x * img.w) / w)) * 4;
      out.data.set(img.data.subarray(s, s + 4), (y * w + x) * 4);
    }
  }
  return out;
}

const count = (m: Uint8Array) => m.reduce((a, v) => a + v, 0);

describe('sheet', () => {
  const b = base();
  const l = planSheet('x', b, ['base', 'talk1', 'blink1'], { w: 400, h: 400 });

  it('人物の範囲に余白を足した範囲を、上限に収まる整数倍で並べる', () => {
    expect(l.crop).toEqual([16, 16, 28, 38]);
    expect(l.scale).toBeGreaterThanOrEqual(3);
    expect(l.w).toBeLessThanOrEqual(400);
    expect(l.h).toBeLessThanOrEqual(400);
  });

  it('描いたシートをそのまま切り分けるとベースに戻る', () => {
    const { frames, detected } = cutSheet(drawSheet(l, b), l, b);
    expect(detected).toBe(true);
    for (const f of frames) expect(count(changedMask(b, f.image))).toBe(0);
  });

  it('大きさが変わっても、1 つの枠だけずれていても、ベースの位置にそろえる', () => {
    const sheet = drawSheet(l, b);
    // 2 番目の枠の中身を 1 ドット分右へずらす
    const o = cellOrigin(l, 1);
    const cw = l.crop[2] * l.scale,
      ch = l.crop[3] * l.scale;
    const copy = sheet.data.slice();
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const sx = x - l.scale;
        const d = ((o.y + y) * l.w + o.x + x) * 4;
        if (sx < 0) sheet.data.set([...l.bg, 255], d);
        else
          sheet.data.set(
            copy.subarray(((o.y + y) * l.w + o.x + sx) * 4, ((o.y + y) * l.w + o.x + sx) * 4 + 4),
            d,
          );
      }
    }
    const big = resize(sheet, Math.round(l.w * 1.37), Math.round(l.h * 1.21));
    const { frames } = cutSheet(big, l, b);
    expect(frames[1]!.dx).toBe(-1);
    for (const f of frames) expect(count(changedMask(b, f.image))).toBe(0);
  });

  it('ガイドの線が無ければ、並びの比で枠を決める', () => {
    const sheet = drawSheet(l, b);
    for (let i = 0; i < sheet.w * sheet.h; i++) {
      const d = sheet.data;
      if (d[i * 4] === l.guide[0] && d[i * 4 + 1] === l.guide[1] && d[i * 4 + 2] === l.guide[2])
        d.set([...l.bg, 255], i * 4);
    }
    const { frames, detected } = cutSheet(sheet, l, b);
    expect(detected).toBe(false);
    expect(count(changedMask(b, frames[2]!.image))).toBe(0);
  });
});
