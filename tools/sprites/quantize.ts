// ドット絵向けの減色（ファイルの読み書きはしない。process.ts とテストから使う）。
// SPEC.md §2・§3 の決まりに合わせる:
//   - 色は DS の 15 ビット色（各成分 c × 255 ÷ 31 の切り捨て）に乗せる
//   - 1 人の全コマで 1 枚のパレット（既定 15 色 + 透明）を共有する
//   - 透明度は 0 か 255 だけ、ディザは使わない
//   - 輪郭（透明に接する点）の暗い色を、パレットのいちばん暗い色として必ず残す
//   - 中間の色の孤立点（アンチエイリアスの名残り）は、隣の色に吸収する
import { blank, type Rgba } from './png.ts';

/** 5 ビットの段 c（0〜31）の 8 ビットの値 */
export const level5 = (c: number) => Math.floor((c * 255) / 31);
const LEVELS = Array.from({ length: 32 }, (_, c) => level5(c));
/** 8 ビットの値にいちばん近い 5 ビットの段 */
const SNAP = Array.from({ length: 256 }, (_, v) => {
  let best = 0;
  for (let c = 1; c < 32; c++) if (Math.abs(LEVELS[c]! - v) < Math.abs(LEVELS[best]! - v)) best = c;
  return best;
});

export const pack = (r: number, g: number, b: number) => (r << 16) | (g << 8) | b;
export const unpack = (c: number): [number, number, number] => [
  (c >> 16) & 255,
  (c >> 8) & 255,
  c & 255,
];

/** 色を 15 ビット色の段に丸める（戻り値も 8 ビット × 3 の packed） */
export function snap555(c: number): number {
  const [r, g, b] = unpack(c);
  return pack(LEVELS[SNAP[r]!]!, LEVELS[SNAP[g]!]!, LEVELS[SNAP[b]!]!);
}

export const is555 = (c: number) => unpack(c).every((v) => LEVELS[SNAP[v]!] === v);

// --- 色の距離は OKLab で測る（見た目の差に近い） ---
const lin = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
type Lab = [number, number, number];
export function oklab(c: number): Lab {
  const [r, g, b] = unpack(c).map(lin) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
const dist2 = (a: Lab, b: Lab) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/** 色ごとの点の数（15 ビット色に丸めてから数える） */
export type Histogram = Map<number, number>;

/** 不透明な点（透明度 128 以上）の色を、15 ビット色に丸めて数える。複数のコマを同じ表に足せる */
export function histogram(imgs: Rgba[], into: Histogram = new Map()): Histogram {
  for (const img of imgs) {
    for (let i = 0; i < img.w * img.h; i++) {
      if (img.data[i * 4 + 3]! < 128) continue;
      const c = snap555(pack(img.data[i * 4]!, img.data[i * 4 + 1]!, img.data[i * 4 + 2]!));
      into.set(c, (into.get(c) ?? 0) + 1);
    }
  }
  return into;
}

export interface PaletteOptions {
  /** 色の数（透明を除く）。SPEC の 1 人 15 色 */
  colors?: number;
  /** 必ず入れる色（輪郭の色など）。k-means で動かさない */
  fixed?: number[];
  /**
   * 点の数の重みの指数（1 = 点の数のまま、0.5 = 平方根）。小さいほど、目・口・ボタンなどの
   * 小さいけれど大事な色が、広い面（服など）に色を取られにくくなる
   */
  weightExp?: number;
  iterations?: number;
}

/** 重みつきの k-means（OKLab）でパレットを作る。初期値は決まった手順で選ぶので、結果は毎回同じ */
export function buildPalette(hist: Histogram, opts: PaletteOptions = {}): number[] {
  const k = opts.colors ?? 15,
    exp = opts.weightExp ?? 0.5,
    fixed = [...new Set((opts.fixed ?? []).map(snap555))];
  const cols = [...hist.keys()].sort((a, b) => a - b);
  if (cols.length <= k)
    return [...new Set([...fixed, ...cols])].slice(0, Math.max(k, fixed.length));
  const labs = cols.map(oklab);
  const ws = cols.map((c) => hist.get(c)! ** exp);
  const cents: Lab[] = fixed.map(oklab);
  // 初期値: いちばん重い色から始め、今の中心から遠く重い色を順に足す（決まった k-means++）
  const near = labs.map((l) =>
    cents.length ? Math.min(...cents.map((c) => dist2(l, c))) : Infinity,
  );
  while (cents.length < k) {
    let bi = 0,
      bv = -1;
    for (let i = 0; i < labs.length; i++) {
      const v = cents.length ? ws[i]! * near[i]! : ws[i]!;
      if (v > bv) [bi, bv] = [i, v];
    }
    if (bv <= 0) break;
    cents.push([...labs[bi]!]);
    for (let i = 0; i < labs.length; i++) near[i] = Math.min(near[i]!, dist2(labs[i]!, labs[bi]!));
  }
  const assign = new Int32Array(labs.length);
  for (let it = 0; it < (opts.iterations ?? 30); it++) {
    for (let i = 0; i < labs.length; i++) assign[i] = nearestIdx(cents, labs[i]!);
    const sum = cents.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < labs.length; i++) {
      const s = sum[assign[i]!]!;
      for (let d = 0; d < 3; d++) s[d]! += labs[i]![d]! * ws[i]!;
      s[3]! += ws[i]!;
    }
    let moved = false;
    for (let j = fixed.length; j < cents.length; j++) {
      const s = sum[j]!;
      if (!s[3]) continue;
      const nc: Lab = [s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!];
      if (dist2(nc, cents[j]!) > 1e-10) moved = true;
      cents[j] = nc;
    }
    if (!moved) break;
  }
  // 中心を、その組の中でいちばん近い実際の色（15 ビット色）にする。中間の作り物の色を避ける
  const out = fixed.slice();
  for (let j = fixed.length; j < cents.length; j++) {
    let bi = -1,
      bd = Infinity;
    for (let i = 0; i < labs.length; i++) {
      if (assign[i] !== j) continue;
      const d = dist2(labs[i]!, cents[j]!);
      if (d < bd) [bi, bd] = [i, d];
    }
    if (bi >= 0 && !out.includes(cols[bi]!)) out.push(cols[bi]!);
  }
  return out;
}

function nearestIdx(cents: Lab[], l: Lab): number {
  let bj = 0,
    bd = Infinity;
  for (let j = 0; j < cents.length; j++) {
    const d = dist2(l, cents[j]!);
    if (d < bd) [bj, bd] = [j, d];
  }
  return bj;
}

/** パレットのいちばん近い色を引く（引いた結果を覚えておく） */
export function matcher(pal: number[]): (c: number) => number {
  const labs = pal.map(oklab);
  const cache = new Map<number, number>();
  return (c) => {
    let v = cache.get(c);
    if (v === undefined) {
      v = pal[nearestIdx(labs, oklab(c))]!;
      cache.set(c, v);
    }
    return v;
  };
}

const lum = (c: number) => {
  const [r, g, b] = unpack(c);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};

/**
 * 輪郭の色: 透明に接する点のうち暗い方の半分の色の中央値（明るさの順）。
 * 生成した絵の輪郭は暗い色で描かれているので、それを 1 色としてパレットに固定する
 */
export function outlineColor(img: Rgba): number | null {
  const { w, h, data } = img;
  const op = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < w && y < h && data[(y * w + x) * 4 + 3]! >= 128;
  const edge: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!op(x, y)) continue;
      if (op(x - 1, y) && op(x + 1, y) && op(x, y - 1) && op(x, y + 1)) continue;
      const i = (y * w + x) * 4;
      edge.push(snap555(pack(data[i]!, data[i + 1]!, data[i + 2]!)));
    }
  }
  if (!edge.length) return null;
  edge.sort((a, b) => lum(a) - lum(b));
  return edge[Math.floor(edge.length / 4)]!;
}

/**
 * 面積平均で縮めた絵を、パレットの色に置き換える（ディザなし）。透明度は 128 を境に 0 / 255 にする。
 * 縮小そのものは呼ぶ側（ImageMagick の Box など）で行う
 */
export function remap(img: Rgba, pal: number[]): Rgba {
  const near = matcher(pal);
  const out = blank(img.w, img.h);
  for (let i = 0; i < img.w * img.h; i++) {
    if (img.data[i * 4 + 3]! < 128) continue;
    const c = near(pack(img.data[i * 4]!, img.data[i * 4 + 1]!, img.data[i * 4 + 2]!));
    out.data.set([...unpack(c), 255], i * 4);
  }
  return out;
}

/**
 * 中間の色の孤立点を吸収する。上下左右に同じ色がなく、左右（または上下）の 2 色の間の明るさの点
 * （縮小で混ざったアンチエイリアスの名残り）を、その 2 色のうち近い方に置き換える。
 * ハイライトのような「まわりより明るい（暗い）」孤立点は残す。
 * 2 色のどちらかが透明なら、輪郭の外側に出たにじみとして、暗い方（輪郭）の色に寄せる
 */
export function absorbStrays(img: Rgba): { img: Rgba; changed: number } {
  const { w, h } = img;
  const src = img.data,
    out = img.data.slice();
  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= w || y >= h || !src[(y * w + x) * 4 + 3]
      ? -1
      : pack(src[(y * w + x) * 4]!, src[(y * w + x) * 4 + 1]!, src[(y * w + x) * 4 + 2]!);
  let changed = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = at(x, y);
      if (c < 0) continue;
      const nb = [at(x - 1, y), at(x + 1, y), at(x, y - 1), at(x, y + 1)];
      if (nb.includes(c)) continue;
      let pick = -1;
      for (const [a, b] of [
        [nb[0]!, nb[1]!],
        [nb[2]!, nb[3]!],
      ] as const) {
        if (a < 0 || b < 0 || a === b) continue;
        const [la, lb, lc] = [lum(a), lum(b), lum(c)];
        if (lc < Math.min(la, lb) || lc > Math.max(la, lb)) continue;
        pick = Math.abs(la - lc) <= Math.abs(lb - lc) ? a : b;
        break;
      }
      if (pick < 0) continue;
      out.set(unpack(pick), (y * w + x) * 4);
      changed++;
    }
  }
  return { img: { w, h, data: out }, changed };
}

/** 画像の不透明な点の色（重なりなし） */
export function colorsOf(img: Rgba): Set<number> {
  const s = new Set<number>();
  for (let i = 0; i < img.w * img.h; i++) {
    if (img.data[i * 4 + 3])
      s.add(pack(img.data[i * 4]!, img.data[i * 4 + 1]!, img.data[i * 4 + 2]!));
  }
  return s;
}

export interface QuantizeOptions extends PaletteOptions {
  /** 輪郭の色をパレットに固定するか（人物・机・証拠品のような透過の絵） */
  keepOutline?: boolean;
  /** 中間の色の孤立点を吸収するか */
  absorb?: boolean;
}

/**
 * 同じパレットを共有するコマの組を減色する（ベースから作り、差分コマをそれに寄せる）。
 *   1. 1 枚目（ベース）の輪郭の色を固定し、差分でないコマ（ベース・ポーズ）の色からパレットを作る
 *   2. 差分でないコマをそのパレットに置き換える
 *   3. 差分コマ（`baseOf[i]` にベースの番号があるもの）は、そのベースで使った色だけに置き換える。
 *      こうすると差分コマにベースにない色が出ない（SPEC.md §2・§7）。
 *      口の中のようにベースにない色は、ベースの近い色（唇の影や輪郭）で描かれる
 */
export function quantizeFrames(
  frames: Rgba[],
  opts: QuantizeOptions = {},
  baseOf: (number | undefined)[] = [],
): { frames: Rgba[]; palette: number[] } {
  const isDiff = (i: number) => baseOf[i] !== undefined && baseOf[i] !== i;
  const outline = opts.keepOutline !== false && frames[0] ? outlineColor(frames[0]) : null;
  const pal = buildPalette(histogram(frames.filter((_, i) => !isDiff(i))), {
    ...opts,
    fixed: [...(opts.fixed ?? []), ...(outline === null ? [] : [outline])],
  });
  const finish = (r: Rgba) => (opts.absorb === false ? r : absorbStrays(r).img);
  const out: Rgba[] = frames.map((f, i) => (isDiff(i) ? f : finish(remap(f, pal))));
  frames.forEach((f, i) => {
    if (!isDiff(i)) return;
    const b = baseOf[i]!;
    if (isDiff(b)) throw new Error(`差分コマ ${i} のベース ${b} も差分コマです`);
    out[i] = finish(remap(f, [...colorsOf(out[b]!)]));
  });
  return { frames: out, palette: pal };
}
