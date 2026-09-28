// 文量の集計: 話・編・シーンごとの台詞の数と文字数、1 台詞の長さ、話し手の割合。
// 使い方: bun tools/analysis/volume.ts > 出力.md

import {
  type Episode,
  GAME_NAME,
  GAMES,
  type Line,
  lineOf,
  loadEpisodes,
  uniqueLines,
  walkEpisode,
} from './corpus.ts';
import { Counter, dist, f, histogram, median, mr, pct, slot, sum, table } from './stats.ts';
import { lineWidth, parseText } from './text.ts';

const eps = await loadEpisodes();
const linesOf = new Map<Episode, Line[]>();
for (const ep of eps) {
  const ls: Line[] = [];
  for (const r of walkEpisode(ep)) {
    const l = lineOf(r);
    if (l) ls.push(l);
  }
  linesOf.set(ep, uniqueLines(ls));
}
const charsOf = (l: Line) => parseText(l.raw, l.color).chars;

console.log('# 文量の集計\n');
console.log(
  '台詞は、同じ話の中で「話し手と文が同じ」ものを 1 つに数える（変換で分岐ごとに写されたものを除く）。',
);
console.log('文字数は文中コマンドと改行を除いた、表示される文字の数。\n');

// 話ごと
console.log('## 話ごと\n');
const rows: (string | number)[][] = [];
const perEp: Record<string, { lines: number; chars: number; inv: number; trial: number }> = {};
for (const ep of eps) {
  const ls = linesOf.get(ep) ?? [];
  const inv = ls.filter((l) => l.rec.ctx.kind === 'investigation');
  const tr = ls.filter((l) => l.rec.ctx.kind === 'trial');
  const blocks = [...new Set(ep.blockOf)];
  const c = sum(ls.map(charsOf));
  perEp[ep.key] = { lines: ls.length, chars: c, inv: inv.length, trial: tr.length };
  rows.push([
    ep.key,
    ep.title,
    blocks.join('・'),
    ls.length,
    c,
    inv.length,
    tr.length,
    pct(tr.length, ls.length, 0),
  ]);
}
console.log(table(['話', '題', '編', '台詞', '文字', '探偵', '法廷', '法廷の割合'], rows));

console.log('\n### 作品ごと（話あたりの中央値（最小〜最大））\n');
console.log(
  table(
    ['作品', '話', '台詞', '文字', '探偵の台詞', '法廷の台詞'],
    GAMES.map((g) => {
      const es = eps.filter((e) => e.game === g).map((e) => perEp[e.key] as (typeof perEp)[string]);
      return [
        GAME_NAME[g],
        es.length,
        mr(es.map((e) => e.lines)),
        mr(es.map((e) => e.chars)),
        mr(es.map((e) => e.inv)),
        mr(es.map((e) => e.trial)),
      ];
    }),
  ),
);

// 編ごと
console.log('\n## 編ごと（探偵○・法廷○）\n');
const blockRows: (string | number)[][] = [];
const blockSizes: Record<string, number[]> = {};
for (const ep of eps) {
  const c = new Counter<string>();
  const ch = new Counter<string>();
  for (const l of linesOf.get(ep) ?? []) {
    c.add(l.rec.ctx.block);
    ch.add(l.rec.ctx.block, charsOf(l));
  }
  for (const b of new Set(ep.blockOf)) {
    blockRows.push([ep.key, b, c.get(b), ch.get(b)]);
    const k = `${ep.game}:${b.slice(0, 2)}`;
    blockSizes[k] ??= [];
    blockSizes[k].push(c.get(b));
  }
}
console.log(table(['話', '編', '台詞', '文字'], blockRows));
console.log('\n### 作品ごとの 1 編の台詞の数\n');
console.log(
  table(
    ['作品', '探偵編', '法廷編'],
    GAMES.map((g) => [
      GAME_NAME[g],
      mr(blockSizes[`${g}:探偵`] ?? []),
      mr(blockSizes[`${g}:法廷`] ?? []),
    ]),
  ),
);

// シーンごと
console.log('\n## シーンごと（台詞が 1 つ以上ある会話シーン・場所）\n');
console.log(
  '変換済みの YAML のシーンは、元の台本の区画（つきつけの分岐・証言の前後など）の単位なので細かい。',
);
console.log(
  '場所（place:）は、1 つの場所の探偵メニューの中身（調べる・話す・つきつける）をまとめて数える。\n',
);
const sceneRows: string[][] = [];
for (const g of GAMES) {
  for (const kind of ['investigation', 'trial']) {
    const c = new Counter<string>();
    for (const ep of eps.filter((e) => e.game === g))
      for (const l of linesOf.get(ep) ?? [])
        if (l.rec.ctx.kind === kind && !l.rec.ctx.scene.startsWith('place:'))
          c.add(`${ep.key}/${l.rec.ctx.scene}`);
    sceneRows.push([
      GAME_NAME[g],
      kind === 'trial' ? '法廷' : '探偵',
      String(c.m.size),
      dist([...c.m.values()]),
    ]);
  }
}
console.log(table(['作品', '編', 'シーン数', '1 シーンの台詞の数'], sceneRows));

// 1 台詞の長さ
console.log('\n## 1 台詞（1 ページ）の長さ\n');
console.log(
  '1 つの台詞のステップが、テキストの枠の 1 ページ（1 行 全角 16 字 × 2 行まで）に当たる。\n',
);
const all = eps.flatMap((e) => linesOf.get(e) ?? []);
const lenRows: string[][] = [];
for (const g of GAMES) {
  const ls = all.filter((l) => l.rec.ctx.ep.game === g);
  const ps = ls.map((l) => parseText(l.raw, l.color));
  const two = ps.filter((p) => p.lines.length >= 2).length;
  const widths = ps.flatMap((p) => p.lines.map((x) => Math.ceil(lineWidth(x))));
  lenRows.push([
    GAME_NAME[g],
    String(ls.length),
    dist(ps.map((p) => p.chars)),
    pct(two, ps.length),
    f(median(widths)),
    pct(widths.filter((w) => w >= 15).length, widths.length),
  ]);
}
console.log(
  table(['作品', '台詞', '文字数', '2 行の割合', '1 行の幅の中央', '15 字以上の行'], lenRows),
);
console.log('\n### 1 台詞の文字数の分布（3 作）\n');
console.log(
  histogram(
    all.map(charsOf).map((c) => Math.floor(c / 4) * 4),
    32,
  ),
);
console.log('\n（値は 4 字きざみの下限。例: 12 = 12〜15 字）');
console.log('\n### 1 行の幅（全角換算）の分布（3 作）\n');
console.log(
  histogram(
    all.flatMap((l) => parseText(l.raw, l.color).lines.map((x) => Math.ceil(lineWidth(x)))),
    16,
  ),
);

// 同じ話し手が続けて話すページ数
console.log('\n### 同じ話し手が続けて話すページ数\n');
const runs: Record<string, number[]> = {};
for (const ep of eps) {
  let prevKey = '';
  let n = 0;
  const flush = () => {
    if (n) slot(runs, ep.game, () => [] as number[]).push(n);
  };
  for (const r of walkEpisode(ep)) {
    const l = lineOf(r);
    if (!l) continue;
    const k = `${r.arrayId}:${l.speaker}:${l.color === 'blue' ? 'b' : ''}`;
    if (k === prevKey) n++;
    else {
      flush();
      n = 1;
      prevKey = k;
    }
  }
  flush();
}
console.log(
  table(
    ['作品', '続けて話すページ数'],
    GAMES.map((g) => [GAME_NAME[g], dist(runs[g] ?? [])]),
  ),
);

// 話し手の割合
console.log('\n## 話し手の割合\n');
console.log('「ナレーション」は名前欄のない台詞、「心の声」は主人公の青字の台詞（別に数える）。\n');
for (const g of GAMES) {
  const ls = all.filter((l) => l.rec.ctx.ep.game === g);
  const c = new Counter<string>();
  for (const l of ls) {
    if (l.speaker === null) c.add('（ナレーション）');
    else if (l.speaker === 'phoenix' && l.color === 'blue') c.add('phoenix（心の声）');
    else c.add(l.speaker);
  }
  console.log(`### ${GAME_NAME[g]}\n`);
  console.log(
    table(
      ['話し手', '台詞', '割合'],
      c.top(15).map(([k, n]) => [k, n, pct(n, ls.length)]),
    ),
  );
  console.log();
}
