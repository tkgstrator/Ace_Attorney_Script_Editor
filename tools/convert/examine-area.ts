// 探偵パートの「調べる」の範囲（investigation.json の examine_tables の 4 点の四角形）を、YAML の範囲にする。
//
// 元のゲームの表の座標は背景の座標（ARM9 0x020353dc: 当たり判定の点 = 触った点 + 背景の位置 0x020ce300+0x1c/0x1e）。
// 横長の背景（512 ドット）でも縮めずに、背景の座標のまま出す（YAML の area も背景の座標）。
// 横長の背景は「調べる」の間に L ボタンで左端と右端の間を動かせる（0x020591b0。エンジン側で行う）。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './tables.ts';

export const SCREEN = { w: 256, h: 192 };

/** 背景の PNG の大きさ（横長の背景は 512×192 など。読めなければ画面の大きさ） */
export function bgSize(file: string | undefined): { w: number; h: number } {
  const p = file ? join(ROOT, file) : '';
  if (!p || !existsSync(p)) return { ...SCREEN };
  const png = readFileSync(p);
  return { w: png.readUInt32BE(16), h: png.readUInt32BE(20) };
}

/**
 * 四角形 4 点 → 背景の中の [x, y, 幅, 高さ]（背景からはみ出す所は切る。背景の外なら null）。
 * 斜めの四角形は外接する長方形だと隣と大きく重なるので、x・y それぞれ 2 番目と 3 番目の値で作る内側の長方形にする
 * （軸に沿った四角形ならそのまま）。潰れるなら外接する長方形
 */
export function areaOf(
  quad: number[][],
  size: { w: number; h: number } = SCREEN,
): [number, number, number, number] | null {
  const xs = quad.map((p) => p[0]!).sort((a, b) => a - b),
    ys = quad.map((p) => p[1]!).sort((a, b) => a - b);
  let [ax, bx] = [xs[1]!, xs[2]!],
    [ay, by] = [ys[1]!, ys[2]!];
  if (bx - ax < 4) [ax, bx] = [xs[0]!, xs[3]!];
  if (by - ay < 4) [ay, by] = [ys[0]!, ys[3]!];
  const x0 = Math.max(0, ax),
    y0 = Math.max(0, ay);
  const x1 = Math.min(size.w, bx),
    y1 = Math.min(size.h, by);
  return x1 - x0 > 0 && y1 - y0 > 0 ? [x0, y0, x1 - x0, y1 - y0] : null;
}

/** 背景 0x73（検事局・地下駐車場）は、パート 0x12 でフラグ 0x45 が立っていると動かせない（0x020591dc） */
export const NO_SCROLL = { bg: 0x73, part: 0x12, flag: 0x45 };

interface PlacesOwner {
  ctx: {
    part: number;
    /** investigation.json のパート（places の各項目に id と bg がある） */
    inv?: { places?: { id: number; bg: number }[] } | null;
    placeId(n: number): string;
    fname(group: number, index: number): string;
  };
  part: { places?: Record<string, Record<string, unknown>> };
}

/**
 * NO_SCROLL の場所に examineScroll（背景を動かせる条件）を付ける。partFlag は章の中の編の番号のフラグ
 * （results の並びの番号。1 編だけの章なら null）
 */
export function markNoScroll(results: PlacesOwner[], partFlag: string | null): void {
  results.forEach((r, k) => {
    if (r.ctx.part !== NO_SCROLL.part || !r.ctx.inv) return;
    for (const pl of r.ctx.inv.places ?? []) {
      if (pl.bg !== NO_SCROLL.bg) continue;
      const id = r.ctx.placeId(pl.id);
      const flag = r.ctx.fname(0, NO_SCROLL.flag);
      const cond = partFlag ? `not (${partFlag} == ${k} and ${flag})` : `not ${flag}`;
      for (const x of results) {
        const places = x.part.places;
        const place = places?.[id];
        if (!places || !place) continue;
        // background の次に置く
        const { name, background, ...rest } = place;
        places[id] = { name, background, examineScroll: cond, ...rest };
      }
    }
  });
}
