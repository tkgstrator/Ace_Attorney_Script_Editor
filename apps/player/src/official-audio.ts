// ROM から取り出して WAV / Ogg に書き出した DS 版の BGM・効果音（assets/extracted/sound/rendered/、手元用・配布しない）。
// tools/rom/sseq_render.py が作る。音の ID は SDAT の名前（BGM018、SE019 など）で、
// 元の台本の [bgm N] / [se N] の N は SDAT のシーケンス番号（index.json の sdatIndex）に当たる。
// 逆転裁判2・3 の章（game = aa2 / aa3）は assets/extracted/aa2/・aa3/sound/rendered/（同じ作り。台本の番号も SDAT の番号）。
// 書き出しは 2 通り。「DS（原音）」= NCSF（DS の音源ドライバーの逆コンパイル）で書き出した sound/ncsf/（tools/rom/ncsf_render.py）、
// 「DS（互換）」= 自前で DS の音源をまねて書き出した sound/rendered/（tools/rom/sseq_render.py）。どちらも同じ名前・同じ index.json の形。
import type { AudioSource, AudioSources } from '@gyakusai/runtime';
import { GAME_ROOT, type OfficialGame } from './official-game.ts';

interface Item {
  name: string;
  category: 'bgm' | 'se';
  sdatIndex: number;
  wav: string;
  loop?: { start: number; end: number };
}

/** 公式の音の書き出し方: ncsf = DS（原音）、compat = DS（互換） */
export type OfficialAudioKind = 'ncsf' | 'compat';

const index = import.meta.glob(
  [
    '../../../assets/extracted/sound/{rendered,ncsf}/index.json',
    '../../../assets/extracted/{aa2,aa3}/sound/{rendered,ncsf}/index.json',
  ],
  { eager: true, import: 'default' },
) as Record<string, { items: Item[] }>;
// Opus（.ogg）は音を削る圧縮と 48 kHz への変換で音色が少し変わるので、書き出したままの WAV（32,728 Hz）を鳴らす
const wavs = import.meta.glob(
  [
    '../../../assets/extracted/sound/{rendered,ncsf}/*/*.wav',
    '../../../assets/extracted/{aa2,aa3}/sound/{rendered,ncsf}/*/*.wav',
  ],
  { eager: true, query: '?url', import: 'default' },
) as Record<string, string>;

const DIR: Record<OfficialAudioKind, string> = { ncsf: 'ncsf', compat: 'rendered' };
const dirOf = (game: OfficialGame, kind: OfficialAudioKind) => `${GAME_ROOT[game]}/sound/${DIR[kind]}`;
const itemsOf = (game: OfficialGame, kind: OfficialAudioKind) =>
  index[`${dirOf(game, kind)}/index.json`]?.items ?? [];

/**
 * サンプルのシナリオで使う意味の名前 → DS 版の音の名前（2・3 も文字送りの音などは同じ名前: tables/sound.json の blip）。試聴ページ（assets/extracted/sound/rendered/index.html）で
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
  evidence_add: 'SE009', // 証拠品を加えたときの窓がすべりこむ音（tables/engine.json の item_slide_se = 51）
  // 聞いて決めるもの
  // trial: 'BGM0xx', investigation: 'BGM0xx', verdict: 'BGM0xx',
  // gavel: 'SE0xx', discover: 'SE0xx',
  // 主人公（成歩堂）の吹き出しの声。本体が吹き出しの絵と一緒に鳴らす（ARM9 0x02031634・0x0202E6BC・0x02031200 の即値）。
  // 検事の声（御剣 SE00E・亜内 SE00F・狩魔 SE017）は、元の台本が吹き出しの直後に se で鳴らす
  shout_objection: 'SE027',
  shout_hold: 'SE01D',
  shout_takethat: 'SE00D',
};

/** 先に読み込んでおく効果音（文字送り・UI の音と、DS 版の全効果音） */
export function soundIdsToPreload(
  game: OfficialGame = 'aa1',
  kind: OfficialAudioKind = 'ncsf',
): string[] {
  const items = itemsOf(game, kind);
  return [...Object.keys(ALIASES), ...items.filter((i) => i.category === 'se').map((i) => i.name)];
}

export function isOfficialAudioAvailable(
  game: OfficialGame = 'aa1',
  kind: OfficialAudioKind = 'ncsf',
): boolean {
  return itemsOf(game, kind).length > 0;
}

/** 使える書き出しのうち既定のもの（原音があれば原音、なければ互換）。どちらも無ければ null */
export function defaultOfficialAudioKind(game: OfficialGame = 'aa1'): OfficialAudioKind | null {
  if (isOfficialAudioAvailable(game, 'ncsf')) return 'ncsf';
  if (isOfficialAudioAvailable(game, 'compat')) return 'compat';
  return null;
}

/** DS 版の音（名前か、ALIASES の意味の名前で引く）。なければ fallback で鳴らす */
export function officialSounds(
  fallback: AudioSources,
  game: OfficialGame = 'aa1',
  kind: OfficialAudioKind = 'ncsf',
): AudioSources {
  const items = itemsOf(game, kind);
  const byName = new Map<string, AudioSource>();
  for (const it of items) {
    const url = wavs[`${dirOf(game, kind)}/${it.wav}`];
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
