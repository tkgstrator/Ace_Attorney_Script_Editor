// 演出の並びの型の集計: 台詞の前の演出の組み合わせ、正しいつきつけの後の並び、ペナルティの前、ゆさぶりの中など。
// 使い方: bun tools/analysis/patterns.ts > 出力.md

import {
  type Episode,
  GAME_NAME,
  GAMES,
  lineOf,
  loadEpisodes,
  type StepRec,
  walkEpisode,
  type Y,
} from './corpus.ts';
import { token } from './fx.ts';
import { Counter, dist, pct, table } from './stats.ts';
import { parseText } from './text.ts';

const eps = await loadEpisodes();
const scenesOf = (ep: Episode): Record<string, Y> =>
  Object.assign({}, ...(ep.data.parts ?? []).map((p: Y) => p.scenes ?? {}));

/** 配列の from 番目からの、意味のある記号の並び（n 個まで） */
function seq(ep: Episode, arr: Y[], from: number, n: number, to = arr.length): string[] {
  const out: string[] = [];
  const chars = ep.characters;
  for (let i = from; i < Math.min(to, arr.length) && out.length < n; i++) {
    const s = arr[i];
    const type = (() => {
      const k = Object.keys(s)[0] ?? '';
      return chars.has(k) && typeof s[k] === 'string' ? 'line' : k;
    })();
    const rec = {
      ctx: { ep },
      step: s,
      type,
      index: i,
      arrayId: -1,
      siblings: arr,
    } as unknown as StepRec;
    const t = token(rec);
    if (t) out.push(t);
    if (type === 'goto') break;
  }
  return out;
}

/** 窓の中に各記号が現れる割合 */
function presence(seqs: string[][], label: string, top = 14): string {
  const c = new Counter<string>();
  for (const s of seqs) for (const t of new Set(s.map((x) => x.replace(/\(.*\)$/, '')))) c.add(t);
  return table(
    [`${label}（${seqs.length} 件）に現れる演出`, '割合'],
    c.top(top).map(([k, n]) => [k, pct(n, seqs.length, 0)]),
  );
}

function count(seqs: string[][]): Counter<string> {
  const c = new Counter<string>();
  for (const s of seqs) c.add(s.join(' → ') || '（ブロックの頭）');
  return c;
}

function heads(seqs: string[][], k: number, top = 10): string {
  const c = new Counter<string>();
  for (const s of seqs) if (s.length) c.add(s.slice(0, k).join(' → '));
  return table(
    ['はじめの並び', '件数'],
    c.top(top).map(([a, n]) => [a, n]),
  );
}

console.log('# 演出の並びの型\n');
console.log(
  '記号は tools/analysis/fx.ts の token()。表示の準備だけのステップ（textbox・wait・location・show など）は飛ばしている。\n',
);

for (const g of GAMES) {
  const clusters = new Counter<string>();
  const inlineCombos = new Counter<string>();
  let lineCount = 0;
  let withFx = 0;
  const afterPresent: string[][] = [];
  const afterDemand: string[][] = [];
  const beforePenalty: string[][] = [];
  const pressSeqs: string[][] = [];
  const pressLines: number[] = [];
  const beforeBgm = new Counter<string>();
  const evWindow: number[] = [];

  for (const ep of eps.filter((e) => e.game === g)) {
    const scenes = scenesOf(ep);
    const seenArr = new Set<number>();
    for (const r of walkEpisode(ep)) {
      const l = lineOf(r);
      if (l) {
        lineCount++;
        // 台詞の直前（前の台詞より後）の演出の組み合わせ
        const fx = new Set<string>();
        for (let i = r.index - 1; i >= 0; i--) {
          const s = r.siblings[i];
          const k = Object.keys(s)[0] ?? '';
          if (ep.characters.has(k) || k === 'say' || k === 'narrate') break;
          if (['shake', 'flash', 'se', 'bgm', 'bgmPause', 'shout', 'fade'].includes(k))
            fx.add(
              k === 'shake'
                ? `揺れ${s.strength ? s.strength : 0}`
                : k === 'fade'
                  ? `fade-${s.fade}`
                  : k,
            );
        }
        if (fx.size) {
          withFx++;
          clusters.add([...fx].sort().join('+'));
        }
        const cmds = parseText(l.raw, l.color).commands.filter((c) =>
          ['flash', 'shake', 'se'].includes(c.name),
        );
        if (cmds.length) inlineCombos.add([...new Set(cmds.map((c) => c.name))].sort().join('+'));
      }
      const w = r.ctx.where;
      // 正しいつきつけ: 証言の present から goto した先のシーン
      if (
        w[0] === 'statements' &&
        w[1] === 'present' &&
        r.type === 'goto' &&
        !seenArr.has(r.arrayId)
      ) {
        seenArr.add(r.arrayId);
        const target = scenes[r.step.goto];
        if (Array.isArray(target)) afterPresent.push(seq(ep, target, 0, 16));
      }
      if (w.at(-2) === 'demand.present' && r.index === 0) {
        const s = seq(ep, r.siblings, 0, 16);
        const last = r.siblings.at(-1);
        if (s.length === 1 && last?.goto && Array.isArray(scenes[last.goto]))
          afterDemand.push(seq(ep, scenes[last.goto], 0, 16));
        else afterDemand.push(s);
      }
      if (r.type === 'penalty')
        beforePenalty.push(seq(ep, r.siblings, Math.max(0, r.index - 12), 30, r.index).slice(-5));
      if (w[0] === 'statements' && w[1] === 'press' && w.length === 2 && r.index === 0) {
        pressSeqs.push(seq(ep, r.siblings, 0, 8));
        let n = 0;
        for (const s of r.siblings) {
          const k = Object.keys(s)[0] ?? '';
          if ((ep.characters.has(k) && typeof s[k] === 'string') || k === 'say') n++;
        }
        pressLines.push(n);
      }
      if (r.type === 'bgm' && r.step.bgm && r.ctx.kind === 'trial')
        beforeBgm.add(
          seq(ep, r.siblings, Math.max(0, r.index - 8), 20, r.index)
            .slice(-3)
            .join(' → ') || '（シーンの頭）',
        );
      if (r.type === 'showEvidence' && r.step.showEvidence) {
        let n = 0;
        for (let i = r.index + 1; i < r.siblings.length; i++) {
          const s = r.siblings[i];
          const k = Object.keys(s)[0] ?? '';
          if (k === 'showEvidence') break;
          if ((ep.characters.has(k) && typeof s[k] === 'string') || k === 'say') n++;
        }
        evWindow.push(n);
      }
    }
  }

  console.log(`## ${GAME_NAME[g]}\n`);
  console.log(
    `### 台詞の直前の演出（台詞 ${lineCount} のうち ${pct(withFx, lineCount)} に何か付く）\n`,
  );
  console.log(
    table(
      ['組み合わせ', '件数', '演出つきの中の割合'],
      clusters.top(12).map(([k, n]) => [k, n, pct(n, withFx)]),
    ),
  );
  console.log(`\n### 台詞の中の演出の組み合わせ（文中コマンド）\n`);
  console.log(table(['組み合わせ', '件数'], inlineCombos.top(8)));
  console.log('\n### 正しいつきつけ（証言の present → goto の先）の後\n');
  console.log(presence(afterPresent, '正しいつきつけの後 16 記号'));
  console.log();
  console.log(heads(afterPresent, 4));
  console.log('\n### つきつけの要求（demand）の正解の後\n');
  console.log(presence(afterDemand, '要求の正解の後 16 記号'));
  console.log('\n### ペナルティの直前 5 記号\n');
  console.log(table(['直前の並び', '件数'], count(beforePenalty).top(8)));
  console.log('\n### ゆさぶり\n');
  console.log(`1 つのゆさぶりの台詞の数（分岐の先を除く）: ${dist(pressLines)}\n`);
  console.log(heads(pressSeqs, 3, 8));
  console.log('\n### 法廷で BGM を切り替える直前の 3 記号\n');
  console.log(table(['直前の並び', '件数'], beforeBgm.top(8)));
  console.log(`\n### 証拠品の小窓を出してから消すまでの台詞の数\n\n${dist(evWindow)}\n`);
}
