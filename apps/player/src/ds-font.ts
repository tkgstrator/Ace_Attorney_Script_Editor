// ROM から取り出した DS 版のフォント（tools/rom/ で作る。配布しないもの）があれば読み込む。
// 無ければ undefined を返し、runtime の既定のフォント（PixelMplus12）で表示する。
import {
  dsDescFontSpec,
  dsFontSpec,
  dsNameFontSpec,
  dsSmallFontSpec,
  dsTitleFontSpec,
  loadBitmapAtlas,
  PIXEL_MPLUS_10,
  PIXEL_MPLUS_12_TIGHT,
  type BitmapAtlas,
  type FontSpec,
} from '@gyakusai/runtime';

const files = import.meta.glob(
  '../../../assets/extracted/font/{ds-font,ds-small-font,ds-small-name-font,ds-small-profile-name-font}.{png,json}',
  { query: '?url', import: 'default', eager: true },
) as Record<string, string>;
const find = (name: string, ext: string) =>
  Object.entries(files).find(([k]) => k.endsWith(`/${name}.${ext}`))?.[1];

async function atlasOf(name: string) {
  const png = find(name, 'png'),
    json = find(name, 'json');
  return png && json ? loadBitmapAtlas(png, json) : undefined;
}

/**
 * 本文用と、法廷記録の説明文・名前・見出し用（見出しは本文のフォントを細く縮めたもの）。
 * 法廷記録の字は、元のゲームの説明文・名前の絵から作った小さい字のフォント（ds-small-font / 証拠品の名前 ds-small-name-font /
 * 人物の名前 ds-small-profile-name-font）。
 * それが無い字は PixelMplus10（名前は本文のフォント）で補う。小さい字のフォントが無ければ、本文のフォントを詰めて並べる
 */
export async function loadDsFont(): Promise<
  | {
      font: FontSpec;
      descriptionFont: FontSpec;
      recordNameFont?: FontSpec;
      recordProfileNameFont?: FontSpec;
      recordTitleFont: FontSpec;
      condensedFont: FontSpec;
    }
  | undefined
> {
  const atlas = await atlasOf('ds-font');
  if (!atlas) return undefined;
  const font = dsFontSpec(atlas);
  const [desc, name, profileName] = await Promise.all([
    atlasOf('ds-small-font'),
    atlasOf('ds-small-name-font'),
    atlasOf('ds-small-profile-name-font'),
  ]);
  return {
    font,
    descriptionFont: descriptionFont(atlas, desc),
    ...(name ? { recordNameFont: dsNameFontSpec(name, font) } : {}),
    ...(profileName ? { recordProfileNameFont: dsNameFontSpec(profileName, font) } : {}),
    recordTitleFont: dsTitleFontSpec(atlas),
    // 長い選択肢は、元のゲームと同じ大きさの本文の字を詰めて並べる（法廷記録の小さい字は使わない）
    condensedFont: dsFontSpec(atlas, 12),
  };
}

/**
 * 法廷記録の説明文のフォント。?descfont= で選ぶ（見比べる用）。
 * - body（既定）: 本文の DS フォントを 12 ドットのマスに詰めて並べる。字がそろっていて、字体が混ざらない
 * - small: 元のゲームの説明文の小さい字。無い字は本文のフォントを縮めて補う（縮めるとつぶれる）
 * - mplus: 元のゲームの説明文の小さい字。無い字は PixelMplus10 で補う
 * - mplus10 / mplus12: 同梱の PixelMplus10（11 ドットのマス）・PixelMplus12（12 ドットのマス）だけで描く
 * 小さい字のフォントは、元のゲームの説明文に出てくる字しか無い（手書きのシナリオでは別の字体が混ざりやすい）
 */
function descriptionFont(atlas: BitmapAtlas, desc: BitmapAtlas | undefined): FontSpec {
  const mode = new URLSearchParams(location.search).get('descfont');
  if (desc && mode === 'small') return dsDescFontSpec(desc, dsSmallFontSpec(atlas));
  if (desc && mode === 'mplus') return dsDescFontSpec(desc, PIXEL_MPLUS_10);
  if (mode === 'mplus10') return { ...PIXEL_MPLUS_10, cell: 11 };
  if (mode === 'mplus12') return PIXEL_MPLUS_12_TIGHT;
  return dsFontSpec(atlas, 12);
}
