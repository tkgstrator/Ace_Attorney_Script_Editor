// ROM から取り出して WAV / Ogg に書き出した DS 版の BGM・効果音（assets/extracted/sound/rendered/、手元用・配布しない）。
// tools/rom/sseq_render.py が作る。音の ID は SDAT の名前（BGM018、SE019 など）で、
// 元の台本の [bgm N] / [se N] の N は SDAT のシーケンス番号（index.json の sdatIndex）に当たる。
import type { AudioSource, AudioSources } from '@gyakusai/runtime';

interface Item {
  name: string;
  category: 'bgm' | 'se';
  sdatIndex: number;
  wav: string;
  loop?: { start: number; end: number };
}

const index = import.meta.glob('../../../assets/extracted/sound/rendered/index.json', {
  eager: true,
  import: 'default',
}) as Record<string, { items: Item[] }>;
// Opus（.ogg）は音を削る圧縮と 48 kHz への変換で音色が少し変わるので、書き出したままの WAV（32,728 Hz）を鳴らす
const wavs = import.meta.glob('../../../assets/extracted/sound/rendered/*/*.wav', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

/**
 * サンプルのシナリオで使う意味の名前 → DS 版の音の名前。試聴ページ（assets/extracted/sound/rendered/index.html）で
 * 聞いて埋める。ここにない名前は、sounds.ts の合成した仮の音で鳴らす
 */
const ALIASES: Record<string, string> = {
  // 解析で分かっているもの（tables/sound.json・engine.json）
  blip_male: 'SE003',
  blip_female: 'SE004',
  blip_typewriter: 'SE01A', // 文字送りの音
  ui_page: 'SE005',
  ui_select: 'SE000',
  ui_decide: 'SE001', // ページ送り・選択肢の移動・決定
  damage: 'SE022', // ライフが減る
  // 聞いて決めるもの
  // trial: 'BGM0xx', investigation: 'BGM0xx', verdict: 'BGM0xx',
  // gavel: 'SE0xx', discover: 'SE0xx',
  // shout_objection: 'SE0xx', shout_hold: 'SE0xx', shout_takethat: 'SE0xx',
};

/** 先に読み込んでおく効果音（文字送り・UI の音と、DS 版の全効果音） */
export function soundIdsToPreload(): string[] {
  const items = Object.values(index)[0]?.items ?? [];
  return [...Object.keys(ALIASES), ...items.filter((i) => i.category === 'se').map((i) => i.name)];
}

export function isOfficialAudioAvailable(): boolean {
  return Object.keys(index).length > 0;
}

/** DS 版の音（名前か、ALIASES の意味の名前で引く）。なければ fallback で鳴らす */
export function officialSounds(fallback: AudioSources): AudioSources {
  const items = Object.values(index)[0]?.items ?? [];
  const byName = new Map<string, AudioSource>();
  for (const it of items) {
    const url = Object.entries(wavs).find(([p]) => p.endsWith(`/${it.wav}`))?.[1];
    if (!url) continue;
    byName.set(
      it.name,
      it.category === 'bgm' && it.loop
        ? { url, loopStart: it.loop.start, loopEnd: it.loop.end }
        : url,
    );
  }
  const find = (id: string) => byName.get(ALIASES[id] ?? id);
  return {
    ...fallback,
    bgm: (id) => find(id) ?? fallback.bgm?.(id),
    se: (id) => find(id) ?? fallback.se?.(id),
  };
}
