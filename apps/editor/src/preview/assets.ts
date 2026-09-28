// プレビューと場所の編集で使う絵・音・フォント。サンプルの読み込み処理をそのまま使う。
// ROM から取り出した DS 版の素材（手元用）があれば、サンプルと同じく DS 版の絵（人物の動き・背景・机・重ね絵・
// 法廷記録のアイコン）と音で出す。なければ生成したドット絵とコードで描いた仮の絵、合成した仮の音。
import { createAudio, type AudioOut, type Assets } from '@gyakusai/runtime';
import { loadDsFont } from '../../../player/src/ds-font.ts';
import { loadImageAssets } from '../../../player/src/image-assets.ts';
import { withOfficialAnims } from '../../../player/src/official-anims.ts';
import { isOfficialAvailable, loadOfficialAssets } from '../../../player/src/official-assets.ts';
import { isOfficialAudioAvailable, officialSounds } from '../../../player/src/official-audio.ts';
import { withOfficialRecord } from '../../../player/src/official-record.ts';
import { withOfficialStage } from '../../../player/src/official-stage.ts';
import { createPlaceholderAssets } from '../../../player/src/placeholder-art.ts';
import { sampleSounds } from '../../../player/src/sounds.ts';

let assets: Promise<Assets> | null = null;
let fonts: ReturnType<typeof loadDsFont> | null = null;
let audio: AudioOut | null = null;

export function getAssets(): Promise<Assets> {
  assets ??= (async () => {
    const generated = await loadImageAssets(createPlaceholderAssets());
    if (!isOfficialAvailable()) return generated;
    return withOfficialStage(
      await withOfficialRecord(await withOfficialAnims(await loadOfficialAssets(generated))),
    );
  })();
  return assets;
}

/** ROM から取り出した DS 版のフォント（手元にあるときだけ。なければ undefined） */
export function getDsFont() {
  fonts ??= loadDsFont().catch(() => undefined);
  return fonts;
}

/** プレビューの音（DS 版の音があればそれ、なければ合成した仮の音） */
export function getAudio(): AudioOut {
  audio ??= createAudio(
    isOfficialAudioAvailable() ? officialSounds(sampleSounds()) : sampleSounds(),
  );
  return audio;
}
