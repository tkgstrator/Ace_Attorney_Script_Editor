// 3DS 版（逆転裁判6）の <E033 話 番号 ラベル>: 台本の番号表の N 番の台本のラベルを呼び、終わると戻る。
// シナリオには呼び出しが無いので、呼ばれたブロックをその場に展開する。ブロックの中から同じ台本の別のラベルへ飛ぶときは、
// その台本がシーンになっていれば goto、なっていなければ（探偵パートの場所の台本など）それも展開する。
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { type Ctx, convertBlock, type Step } from './convert.ts';
import { mainLabel, type Shared, sceneId } from './file.ts';
import { type Entry, readGmdText, tokenize } from './gmd.ts';

export type CallOpts = {
  /** 今の話（0 始まり）と、その名前（sce02） */
  sceIdx: number;
  sce: string;
  /** 表の番号（今の話・11 人物・12 場所）→ 台本の名前の並び */
  tables: Map<number, (string | null)[]>;
  dir: string;
  /** シーンにしたファイル（c200_0100 など） */
  converted: Set<string>;
};

const native = (to: number, idx: number): Step[] => [{ native: 'E033', args: [to, idx] }];

/** 探偵パートの入口（<E052> で見る、今の物語のファイルの章・シーン）と、<E394>（探偵パートを終える）の行き先 */
type Hub = { chap: number; scene: number; end: Step[] };

export function makeCall(
  o: CallOpts,
  shared: () => Shared,
): { call: Shared['call']; investigate: Shared['investigate'] } {
  const cache = new Map<string, Entry[] | null>();
  const active = new Set<string>();
  const load = (name: string) => {
    if (!cache.has(name)) {
      const p = join(o.dir, `_${name}_jpn.txt`);
      cache.set(name, existsSync(p) ? readGmdText(p) : null);
    }
    return cache.get(name) ?? null;
  };

  const block = (short: string, entries: Entry[], k: number, hub?: Hub): Step[] => {
    const key = `${short}:${k}`;
    // 呼び出しが自分に戻る輪は、2 度目を展開しない
    if (active.has(key)) return [];
    active.add(key);
    const main = mainLabel(entries);
    const ctx: Ctx = {
      ...shared(),
      jump: (n) => {
        const label = entries[n]?.label;
        if (!label || /^L_(INIT|LOAD)$/.test(label)) return [];
        return o.converted.has(short)
          ? [{ goto: sceneId(short, label, main) }]
          : block(short, entries, n, hub);
      },
      end: () => [],
      ...(hub ? { hub } : {}),
      endInvest: () => (hub ? hub.end : [{ native: 'E394', args: [] }]),
      callLocal: (n) => block(short, entries, n, hub),
      freeRoam: (n) => [{ native: 'E393', args: [0, n] }],
      reveal: () => null,
      game: () => [{ native: 'game', args: [] }],
      pointOut: () => null,
      spotName: (_label, spot) => `調べる所 ${spot}`,
      choicesAt: () => [],
    };
    const steps = convertBlock(tokenize(entries[k]!.text), ctx, k);
    active.delete(key);
    return steps;
  };

  const call: Shared['call'] = (to, idx, label) => {
    const name = o.tables.get(to)?.[idx] ?? undefined;
    const entries = name ? load(name) : null;
    const k = entries?.findIndex((e) => e.label === label) ?? -1;
    if (!name || !entries || k < 0) return native(to, idx);
    // 今の話の物語のファイルならシーン名と同じ短い名前、ほか（場所・人物の台本）は名前のまま
    const story = name.startsWith(`${o.sce}_`) && /_c\d{3}_\d{4}$/.test(name);
    return block(story ? name.replace(`${o.sce}_`, '') : name, entries, k);
  };

  // 探偵パート（L_DTC_START）の近似: 場所の台本（bg）のうち、最初のラベルの <E052 話 章 シーン ラベル> でこの物語の
  // ファイルを指すものの出来事を、ファイル名の順に展開する。場所を回る・話す・調べるは入らない
  const places = readdirSync(o.dir)
    .filter((f) => f.startsWith(`_${o.sce}_bg`) && f.endsWith('_jpn.txt'))
    .sort()
    .map((f) => f.replace(/^_/, '').replace(/_jpn\.txt$/, ''));
  const investigate: Shared['investigate'] = (chap, scene, end) => {
    const steps: Step[] = [{ native: 'investigation', args: [chap, scene] }];
    for (const name of places) {
      const entries = load(name);
      const first = entries?.[0];
      const refers =
        first &&
        tokenize(first.text).some(
          (t) => t.kind === 'cmd' && t.name === 'E052' && t.args[1] === chap && t.args[2] === scene,
        );
      if (entries && refers) steps.push(...block(name, entries, 0, { chap, scene, end }));
    }
    return [...steps, ...end];
  };
  return { call, investigate };
}
