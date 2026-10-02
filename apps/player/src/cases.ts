// 遊べる章の一覧。サンプルの事件と、元の台本から変換した章（assets/extracted/converted/、手元用・配布しない）。
// 逆転裁判2・3 から変換した章は assets/extracted/aa2/converted/・aa3/converted/ にあり、絵と音もそのゲームのものを使う。
import clocktower from '../cases/clocktower.yaml?raw';
import masked from '../cases/masked.yaml?raw';
import type { OfficialGame } from './official-game.ts';

const converted = import.meta.glob('../../../assets/extracted/converted/*.yaml', {
  query: '?raw',
  import: 'default',
});
const converted2 = import.meta.glob('../../../assets/extracted/aa2/converted/*.yaml', {
  query: '?raw',
  import: 'default',
});
const converted3 = import.meta.glob('../../../assets/extracted/aa3/converted/*.yaml', {
  query: '?raw',
  import: 'default',
});

export interface CaseEntry {
  id: string;
  label: string;
  /** タイトル（作品）。プレイヤーの「タイトル」の選択に出す */
  series: string;
  /** タイトルの中での章の名前。プレイヤーの「章」の選択に出す */
  chapter: string;
  /** DS 版の絵と音をどのゲームから取るか（サンプルは蘇る逆転） */
  game: OfficialGame;
  load: () => Promise<string>;
}

const fileId = (path: string) => path.replace(/^.*\//, '').replace(/\.yaml$/, '');

function entries(
  glob: Record<string, () => Promise<unknown>>,
  game: OfficialGame,
  prefix: string,
  label: string,
  series: string,
): CaseEntry[] {
  return Object.entries(glob).map(([path, load]) => ({
    id: `${prefix}${fileId(path)}`,
    label: `${label}${fileId(path)}`,
    series,
    chapter: fileId(path),
    game,
    load: load as () => Promise<string>,
  }));
}

export const CASES: CaseEntry[] = [
  {
    id: 'clocktower',
    label: 'サンプル: 時計塔の鐘',
    series: 'サンプル',
    chapter: '時計塔の鐘',
    game: 'aa1',
    load: async () => clocktower,
  },
  {
    id: 'masked',
    label: 'サンプル: 仮面の奇術師',
    series: 'サンプル',
    chapter: '仮面の奇術師',
    game: 'aa1',
    load: async () => masked,
  },
  ...entries(converted, 'aa1', '', '変換: ', '逆転裁判 蘇る逆転'),
  ...entries(converted2, 'aa2', 'aa2-', '逆転裁判2: ', '逆転裁判2'),
  ...entries(converted3, 'aa3', 'aa3-', '逆転裁判3: ', '逆転裁判3'),
];

/** URL の ?case= で選んだ章（なければ最初） */
export function selectedCase(): CaseEntry {
  const id = new URLSearchParams(location.search).get('case');
  return CASES.find((c) => c.id === id) ?? CASES[0]!;
}
