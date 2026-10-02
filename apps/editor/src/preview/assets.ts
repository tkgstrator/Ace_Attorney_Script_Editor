// プレビューと場所の編集で使う絵・音・フォント。サンプルの読み込み処理をそのまま使う。
// ROM から取り出した DS 版の素材（手元用）があれば、サンプルと同じく DS 版の絵（人物の動き・背景・机・重ね絵・
// 法廷記録のアイコン）と音で出す。なければ生成したドット絵とコードで描いた仮の絵、合成した仮の音。
// 逆転裁判2・3 から変換した章（置き場所 official2 / official3）は、そのゲームの絵と音を使う。章の名前を渡さなければ、
// 最後に開いた章（エディターが覚えている名前）から決める。
import { type Assets, type AudioOut, createAudio } from '@gyakusai/runtime';
import { loadDsFont } from '../../../player/src/ds-font.ts';
import { loadImageAssets } from '../../../player/src/image-assets.ts';
import { withOfficialAnims } from '../../../player/src/official-anims.ts';
import { isOfficialAvailable, loadOfficialAssets } from '../../../player/src/official-assets.ts';
import { defaultOfficialAudioKind, officialSounds } from '../../../player/src/official-audio.ts';
import { gameOf, type OfficialGame } from '../../../player/src/official-game.ts';
import { withOfficialRecord } from '../../../player/src/official-record.ts';
import { withOfficialStage } from '../../../player/src/official-stage.ts';
import { createPlaceholderAssets } from '../../../player/src/placeholder-art.ts';
import { sampleSounds } from '../../../player/src/sounds.ts';

/** エディターが最後に開いた章を覚えておく名前（state/store.ts の LAST_FILE_KEY と同じ） */
const LAST_FILE_KEY = 'gyakusai:editor:file';

const assets = new Map<OfficialGame, Promise<Assets>>();
let fonts: ReturnType<typeof loadDsFont> | null = null;
const audio = new Map<OfficialGame, AudioOut>();

/** 章の名前（「置き場所/ファイル名」）→ ゲーム。無ければ最後に開いた章 */
function currentGame(chapter?: string | null): OfficialGame {
  if (chapter !== undefined) return gameOf(chapter);
  try {
    return gameOf(localStorage.getItem(LAST_FILE_KEY));
  } catch {
    return 'aa1';
  }
}

export function getAssets(chapter?: string | null): Promise<Assets> {
  const game = currentGame(chapter);
  let a = assets.get(game);
  if (!a) {
    a = (async () => {
      const generated = await loadImageAssets(createPlaceholderAssets());
      if (!isOfficialAvailable(game)) return generated;
      return withOfficialStage(
        await withOfficialRecord(
          await withOfficialAnims(await loadOfficialAssets(generated, game), game),
          game,
        ),
        game,
      );
    })();
    assets.set(game, a);
  }
  return a;
}

/** ROM から取り出した DS 版のフォント（手元にあるときだけ。なければ undefined） */
export function getDsFont() {
  fonts ??= loadDsFont().catch(() => undefined);
  return fonts;
}

/** プレビューの音（DS 版の音があればそれ（原音、なければ互換）、なければ合成した仮の音） */
export function getAudio(chapter?: string | null): AudioOut {
  const game = currentGame(chapter);
  let a = audio.get(game);
  if (!a) {
    const kind = defaultOfficialAudioKind(game);
    a = createAudio(kind ? officialSounds(sampleSounds(), game, kind) : sampleSounds());
    audio.set(game, a);
  }
  return a;
}
