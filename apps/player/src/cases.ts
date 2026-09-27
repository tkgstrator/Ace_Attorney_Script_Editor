// 遊べる章の一覧。サンプルの事件と、元の台本から変換した章（assets/extracted/converted/、手元用・配布しない）。
import clocktower from '../cases/clocktower.yaml?raw';

const converted = import.meta.glob('../../../assets/extracted/converted/*.yaml', { query: '?raw', import: 'default' });

export interface CaseEntry { id: string; label: string; load: () => Promise<string> }

export const CASES: CaseEntry[] = [
  { id: 'clocktower', label: 'サンプル: 時計塔の鐘', load: async () => clocktower },
  ...Object.entries(converted).map(([path, load]) => {
    const id = path.replace(/^.*\//, '').replace(/\.yaml$/, '');
    return { id, label: `変換: ${id}`, load: load as () => Promise<string> };
  }),
];

/** URL の ?case= で選んだ章（なければ最初） */
export function selectedCase(): CaseEntry {
  const id = new URLSearchParams(location.search).get('case');
  return CASES.find(c => c.id === id) ?? CASES[0]!;
}
