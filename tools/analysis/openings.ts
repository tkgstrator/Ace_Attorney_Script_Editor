// 編の始まりと終わりの並びの集計（探偵編・法廷編がどう始まり、どう終わるか）。
// 使い方: bun tools/analysis/openings.ts > 出力.md

import { type Episode, loadEpisodes, type StepRec, stepType, type Y } from './corpus.ts';
import { token } from './fx.ts';
import { Counter, pct, table } from './stats.ts';

const eps = await loadEpisodes();

/** 配列を記号の並びにする。台詞の続きは「台詞×n」にまとめ、場所へ行く・シーン移動も記号にする */
function tokens(ep: Episode, arr: Y[]): string[] {
  const out: string[] = [];
  arr.forEach((s, i) => {
    const type = stepType(s, ep.characters);
    let t = token({
      ctx: { ep },
      step: s,
      type,
      index: i,
      arrayId: -1,
      siblings: arr,
    } as unknown as StepRec);
    if (type === 'investigate') t = '探偵メニュー';
    if (type === 'testimony') t = '証言';
    if (type === 'location' && typeof s.location === 'string') t = '';
    if (!t) return;
    t = t.replace(/\(.*\)$/, (m) => (t.startsWith('台詞') ? m.replace(/\+.*\)/, ')') : ''));
    const last = out.at(-1);
    if (last && last.replace(/×\d+$/, '') === t && t.startsWith('台詞')) {
      const n = Number(last.match(/×(\d+)$/)?.[1] ?? 1) + 1;
      out[out.length - 1] = `${t}×${n}`;
    } else out.push(t);
  });
  return out;
}

const first = new Counter<string>();
const rows: string[][] = [];
const blocks = { investigation: 0, trial: 0 };

/** シーンのはじめの n 記号。goto で終わる短いシーンは、移った先を続けて読む */
function opening(
  ep: Episode,
  scenes: Record<string, Y>,
  id: string,
  n: number,
  hops = 4,
): string[] {
  const arr = scenes[id];
  if (!Array.isArray(arr)) return [];
  const ts = tokens(ep, arr);
  const last = arr.at(-1);
  if (ts.length < n && hops > 0 && last?.goto) {
    return [
      ...ts.slice(0, -1),
      ...opening(ep, scenes, last.goto, n - ts.length + 1, hops - 1),
    ].slice(0, n);
  }
  return ts.slice(0, n);
}

for (const ep of eps) {
  const parts: Y[] = ep.data.parts ?? [];
  const scenes: Record<string, Y> = Object.assign({}, ...parts.map((p) => p.scenes ?? {}));
  const seen = new Set<string>();
  parts.forEach((p, pi) => {
    const b = ep.blockOf[pi] as string;
    if (seen.has(b)) return;
    seen.add(b);
    blocks[p.kind as 'trial']++;
    const id = Object.keys(p.scenes ?? {}).find((k) => Array.isArray(p.scenes[k]));
    const ts = id ? opening(ep, scenes, id, 12) : [];
    rows.push([ep.key, b, ts.join(' → ')]);
    for (const t of new Set(ts.map((x) => x.replace(/×\d+$/, '')))) first.add(`${p.kind}:${t}`);
  });
}

console.log('# 編の始まり\n');
console.log('各編の最初の会話シーンのはじめ 12 記号（goto で終わる短いシーンは移った先も読む）。');
console.log('記号は fx.ts の token()（台詞の続きは ×n にまとめる）。\n');
console.log(table(['話', '編', 'はじめの並び'], rows));
for (const kind of ['investigation', 'trial'] as const) {
  const n = blocks[kind];
  console.log(`\n## ${kind === 'trial' ? '法廷' : '探偵'}編（${n}）\n`);
  const f = [...first.m].filter(([k]) => k.startsWith(`${kind}:`)).sort((a, b) => b[1] - a[1]);
  console.log(
    table(
      ['はじめの 12 記号に現れる', '割合'],
      f.slice(0, 14).map(([k, c]) => [k.slice(kind.length + 1), pct(c, n, 0)]),
    ),
  );
}
