import type { PlayerOptions } from './options.ts';
import type { Fonts } from './painter.ts';
import { TextRenderer, type BitmapAtlas, type FontSpec } from './text.ts';

// 同梱のフォント PixelMplus（M+ FONT LICENSE。fonts/ を参照）と、ドット画像のフォントの読み込み

/**
 * 本文用。ドット格子の上端はベースラインの 11.6 ドット上、下端は 2.4 ドット下。
 * かな・漢字は 14 ドットの画像のうち上から 1〜12 ドット目に描かれる。
 * DS 版に合わせ、14 ドットのマスに等幅で並べる（文字の間は 2 ドット）
 */
export const PIXEL_MPLUS_12: FontSpec = {
  family: '"PixelMplus12"',
  size: 12,
  ascent: 11.6,
  rows: 14,
  ink: { top: 1, bottom: 13 },
  cell: 14,
};

/** 証拠品・人物の説明文用。PixelMplus12 を詰めて（12 ドットのマスで）並べる */
export const PIXEL_MPLUS_12_TIGHT: FontSpec = { ...PIXEL_MPLUS_12, cell: 12 };

/** 名前欄など小さい文字用。格子の上端はベースラインの 10 ドット上、かな・漢字は 1〜10 ドット目 */
export const PIXEL_MPLUS_10: FontSpec = {
  family: '"PixelMplus10"',
  size: 10,
  ascent: 10,
  rows: 12,
  ink: { top: 1, bottom: 11 },
  cell: 10,
};

const FILES = {
  PixelMplus12: new URL('../fonts/PixelMplus12-Regular.ttf', import.meta.url).href,
  PixelMplus10: new URL('../fonts/PixelMplus10-Regular.ttf', import.meta.url).href,
};

/** 同梱フォントを読み込んで document.fonts に登録する */
export async function loadFonts(): Promise<void> {
  await Promise.all(
    Object.entries(FILES).map(async ([family, url]) => {
      const face = new FontFace(family, `url(${url})`);
      await face.load();
      document.fonts.add(face);
    }),
  );
}

/**
 * ドット画像のフォント（全文字を size × size のマスに columns 列で並べた PNG と、{ size, columns, chars } の JSON）を読み込む。
 * 作り直したときに古いものが使われないよう、毎回サーバーに更新を確かめる
 */
export async function loadBitmapAtlas(pngUrl: string, jsonUrl: string): Promise<BitmapAtlas> {
  const [meta, img] = await Promise.all([
    fetch(jsonUrl, { cache: 'no-cache' }).then(
      (r) => r.json() as Promise<{ size: number; columns: number; chars: string }>,
    ),
    fetch(pngUrl, { cache: 'no-cache' })
      .then((r) => r.blob())
      .then((b) => createImageBitmap(b)),
  ]);
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  const index = new Map([...meta.chars].map((ch, i) => [ch, i]));
  return {
    size: meta.size,
    columns: meta.columns,
    index,
    width: img.width,
    pixels: g.getImageData(0, 0, img.width, img.height).data,
  };
}

/**
 * DS 版から取り出したフォント（tools/rom/build_font.py で作る ds-font.png / ds-font.json）の設定。
 * 16×16 のマスの 3〜15 行目に字形があり、14 ドットのマスで並べる。ない文字は fallback で描く
 */
export function dsFontSpec(
  atlas: BitmapAtlas,
  cell = 14,
  fallback: FontSpec = PIXEL_MPLUS_12,
): FontSpec {
  return {
    // dx・dy は、DS 版の画面と点の単位で一致するように測った値
    family: 'ds-font',
    size: 13,
    ascent: 0,
    rows: 16,
    ink: { top: 3, bottom: 16 },
    cell,
    dx: -1,
    dy: -1,
    bitmap: { atlas },
    fallback: { ...fallback, cell },
  };
}

/**
 * ドット画像のフォントを、DS の 1 ドット単位で縮めた版を作る（法廷記録の説明文など、小さい字用）。
 * 縮めた先の 1 ドットに、元の点が threshold 以上かかっていれば点にする（細い線が消えにくいよう低めにしている）。
 * width を指定すると横だけさらに縮め（字形はマスの左の width ドットに入る）、縦長の字にする
 */
export function scaleAtlas(
  atlas: BitmapAtlas,
  size: number,
  threshold = 0.3,
  width = size,
): BitmapAtlas {
  const src = atlas.size;
  const rows = Math.ceil(atlas.index.size / atlas.columns);
  const imageWidth = atlas.columns * size;
  const pixels = new Uint8ClampedArray(imageWidth * rows * size * 4);
  const on = (x: number, y: number) => (atlas.pixels[(y * atlas.width + x) * 4]! >= 128 ? 1 : 0);
  for (let cell = 0; cell < atlas.columns * rows; cell++) {
    const sx0 = (cell % atlas.columns) * src,
      sy0 = Math.floor(cell / atlas.columns) * src;
    const dx0 = (cell % atlas.columns) * size,
      dy0 = Math.floor(cell / atlas.columns) * size;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < width; x++) {
        // 縮めた先の 1 ドットが覆う元の範囲の、点の割合
        const x0 = (x * src) / width,
          x1 = ((x + 1) * src) / width,
          y0 = (y * src) / size,
          y1 = ((y + 1) * src) / size;
        let cover = 0;
        for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
          const hy = Math.min(y1, yy + 1) - Math.max(y0, yy);
          for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
            cover += on(sx0 + xx, sy0 + yy) * hy * (Math.min(x1, xx + 1) - Math.max(x0, xx));
          }
        }
        if (cover / ((x1 - x0) * (y1 - y0)) < threshold) continue;
        const i = ((dy0 + y) * imageWidth + dx0 + x) * 4;
        pixels[i] = pixels[i + 1] = pixels[i + 2] = pixels[i + 3] = 255;
      }
    }
  }
  return { size, columns: atlas.columns, index: atlas.index, width: imageWidth, pixels };
}

/**
 * DS 版のフォントを縮めた、法廷記録の説明文用のフォント。元のゲームの説明文は字の高さ約 10 ドット・11 ドット送りで、
 * 文字を描き込んだ絵として持っている（日本語の小さい字のフォントは無い）ので、本文のフォントを 13/16 に縮めて近づける
 */
export function dsSmallFontSpec(
  atlas: BitmapAtlas,
  cell = 11,
  fallback: FontSpec = PIXEL_MPLUS_10,
): FontSpec {
  const size = 13;
  const small = scaleAtlas(atlas, size);
  const k = size / atlas.size;
  return {
    family: 'ds-font-small',
    size: Math.round(13 * k),
    ascent: 0,
    rows: size,
    ink: { top: Math.round(3 * k), bottom: size },
    cell,
    dx: 0,
    dy: -1,
    bitmap: { atlas: small },
    fallback: { ...fallback, cell },
  };
}

/**
 * 法廷記録の説明文の字（元のゲームの説明文の絵から作った ds-small-font。12×12 のマス、11 ドット送り、字の高さ 10）。
 * 字のマスの左上を (x, 行の上端) に置き、点はマスの 1〜10 行目にある。ない字は fallback（本文のフォントを縮めたものなど）で描く
 */
export function dsDescFontSpec(atlas: BitmapAtlas, fallback: FontSpec = PIXEL_MPLUS_10): FontSpec {
  return {
    family: 'ds-desc-font',
    size: 11,
    ascent: 0,
    rows: 12,
    ink: { top: 1, bottom: 11 },
    cell: 11,
    bitmap: { atlas },
    fallback: { ...fallback, cell: 11 },
  };
}

/**
 * 法廷記録の名前の字（元のゲームの名前の絵から作った ds-small-name-font。14×14 のマス、14 ドット送り、字の高さ 12）。
 * 点はマスの 1〜12 行目にある
 */
export function dsNameFontSpec(atlas: BitmapAtlas, fallback: FontSpec = PIXEL_MPLUS_12): FontSpec {
  return {
    family: 'ds-name-font',
    size: 14,
    ascent: 0,
    rows: Math.max(14, atlas.size),
    ink: { top: 1, bottom: 13 },
    cell: 14,
    bitmap: { atlas },
    fallback: { ...fallback, cell: 14 },
  };
}

/**
 * 法廷記録の見出し（「証拠品ファイル」）とタブの字。DS 版では縦長の細い字（高さ約 12、8〜10 ドット送り）なので、
 * 本文の DS フォントを横だけ 9/16 に縮めて近づける（9 ドット送り）
 */
export function dsTitleFontSpec(atlas: BitmapAtlas, fallback: FontSpec = PIXEL_MPLUS_10): FontSpec {
  return {
    family: 'ds-title-font',
    size: 8,
    ascent: 0,
    rows: atlas.size,
    ink: { top: 3, bottom: atlas.size },
    cell: 9,
    bitmap: { atlas: scaleAtlas(atlas, atlas.size, 0.3, 9) },
    fallback: { ...fallback, cell: 9 },
  };
}

/** Player の設定から、画面で使うフォント一式を作る（指定の無いものは同梱のフォント） */
export function createFonts(ctx: CanvasRenderingContext2D, opts: PlayerOptions): Fonts {
  const make = (spec: FontSpec) => new TextRenderer(ctx, spec);
  return {
    text: make(opts.font ?? PIXEL_MPLUS_12),
    small: make(opts.smallFont ?? PIXEL_MPLUS_10),
    desc: make(opts.descriptionFont ?? PIXEL_MPLUS_12_TIGHT),
    ...(opts.recordNameFont ? { name: make(opts.recordNameFont) } : {}),
    ...(opts.recordProfileNameFont ? { profileName: make(opts.recordProfileNameFont) } : {}),
    ...(opts.recordTitleFont ? { title: make(opts.recordTitleFont) } : {}),
    ...(opts.condensedFont ? { condensed: make(opts.condensedFont) } : {}),
  };
}
