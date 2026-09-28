// 構成の集計: 探偵パート（場所・話題・調べる所・つきつけ）と法廷パート（証言・尋問・ゆさぶり・選択肢・ペナルティ）。
// 使い方: bun tools/analysis/structure.ts > 出力.md

import {
  GAME_NAME,
  GAMES,
  type Line,
  lineOf,
  loadEpisodes,
  walkEpisode,
  type Y,
} from './corpus.ts';
import { Counter, dist, mr, pct, slot, table } from './stats.ts';
import { parseText } from './text.ts';

const eps = await loadEpisodes();

/** 台詞の数。goto の先のシーンも 1 段だけたどる（調べる・話すの中身が別のシーンに書かれていることが多いため） */
const countLines = (
  arr: Y[] | undefined,
  chars: Set<string>,
  scenes: Record<string, Y> = {},
  depth = 1,
): number => {
  let n = 0;
  const visit = (v: Y) => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') {
      const k = Object.keys(v)[0] ?? '';
      if ((chars.has(k) && typeof v[k] === 'string') || k === 'say' || k === 'narrate') n++;
      if (k === 'goto' && depth > 0 && Array.isArray(scenes[v.goto]))
        n += countLines(scenes[v.goto], chars, scenes, depth - 1);
      for (const x of Object.values(v)) if (typeof x === 'object') visit(x);
    }
  };
  visit(arr ?? []);
  return n;
};
const scenesOf = (data: Y): Record<string, Y> =>
  Object.assign({}, ...(data.parts ?? []).map((p: Y) => p.scenes ?? {}));

console.log('# 構成の集計\n');

// 探偵パート
console.log('## 探偵パート\n');
console.log('場所は、調べる所か話題が 1 つ以上ある場所を、探偵編ごとに数える（同じ場所は 1 つ）。');
console.log(
  '話題は話題の名前の種類、調べる所は ID（無ければ範囲）の種類で数える（条件で出し分ける版は 1 つにまとめる）。\n',
);
const invRows: (string | number)[][] = [];
const per: Record<
  string,
  {
    places: number[];
    topics: number[];
    exam: number[];
    present: number[];
    topicLen: number[];
    examLen: number[];
    cards: number[];
    gatedTopics: number[];
    gatedMoves: number[];
  }
> = {};
for (const ep of eps) {
  const g = ep.game;
  const acc = slot(per, g, () => ({
    places: [],
    topics: [],
    exam: [],
    present: [],
    topicLen: [],
    examLen: [],
    cards: [],
    gatedTopics: [],
    gatedMoves: [],
  }));
  const blocks = new Map<
    string,
    {
      places: Map<string, { topics: Set<string>; exam: Set<string>; present: Set<string> }>;
      cards: number;
      talk: number;
      gated: number;
      moves: number;
      gatedMoves: number;
    }
  >();
  const scenes = scenesOf(ep.data);
  (ep.data.parts ?? []).forEach((p: Y, pi: number) => {
    if (p.kind !== 'investigation') return;
    const b = ep.blockOf[pi] as string;
    const blk = blocks.get(b) ?? {
      places: new Map(),
      cards: 0,
      talk: 0,
      gated: 0,
      moves: 0,
      gatedMoves: 0,
    };
    blocks.set(b, blk);
    for (const [id, pl] of Object.entries<Y>(p.places ?? {})) {
      const talk: Y[] = pl.talk ?? [];
      const exam: Y[] = pl.examine ?? [];
      if (!talk.length && !exam.length) continue;
      const e = blk.places.get(id) ?? { topics: new Set(), exam: new Set(), present: new Set() };
      blk.places.set(id, e);
      for (const t of talk) {
        if (!e.topics.has(t.topic)) acc.topicLen.push(countLines(t.then, ep.characters, scenes));
        e.topics.add(t.topic);
        blk.talk++;
        if (t.when) blk.gated++;
      }
      for (const x of exam) {
        const k = x.id ?? JSON.stringify(x.area);
        if (!e.exam.has(k)) acc.examLen.push(countLines(x.then, ep.characters, scenes));
        e.exam.add(k);
      }
      for (const k of Object.keys(pl.present ?? {})) e.present.add(k);
      for (const m of pl.move ?? []) {
        blk.moves++;
        if (typeof m === 'object' && m.when) blk.gatedMoves++;
      }
    }
  });
  for (const r of walkEpisode(ep)) {
    if (r.type === 'card' && r.ctx.kind === 'investigation') {
      const blk = blocks.get(r.ctx.block);
      if (blk) blk.cards++;
    }
  }
  for (const [b, blk] of blocks) {
    const ps = [...blk.places.values()];
    const topics = ps.reduce((a, x) => a + x.topics.size, 0);
    const exam = ps.reduce((a, x) => a + x.exam.size, 0);
    invRows.push([
      ep.key,
      b,
      ps.length,
      topics,
      exam,
      ps.reduce((a, x) => a + x.present.size, 0),
      blk.cards,
      pct(blk.gatedMoves, blk.moves, 0),
    ]);
    acc.places.push(ps.length);
    for (const x of ps) {
      acc.topics.push(x.topics.size);
      acc.exam.push(x.exam.size);
      acc.present.push(x.present.size);
    }
    acc.cards.push(blk.cards);
  }
}
console.log(
  table(
    [
      '話',
      '編',
      '場所',
      '話題',
      '調べる所',
      'つきつけの反応',
      '日時・場所の表示',
      '条件つきの移動',
    ],
    invRows,
  ),
);
console.log('\n### 作品ごと\n');
console.log(
  table(
    [
      '作品',
      '1 編の場所',
      '1 場所の話題',
      '1 場所の調べる所',
      '1 場所のつきつけの反応',
      '1 話題の台詞',
      '1 か所を調べた台詞',
    ],
    GAMES.map((g) => {
      const a = per[g];
      if (!a) return [GAME_NAME[g], '-', '-', '-', '-', '-', '-'];
      return [
        GAME_NAME[g],
        mr(a.places),
        mr(a.topics),
        mr(a.exam),
        mr(a.present),
        mr(a.topicLen),
        mr(a.examLen),
      ];
    }),
  ),
);

// サイコ・ロック
console.log('\n### サイコ・ロック（逆転裁判2・3）\n');
const lockRows: (string | number)[][] = [];
for (const ep of eps) {
  const locks = new Map<string, number>();
  let breaks = 0;
  for (const r of walkEpisode(ep)) {
    if (r.type === 'psycheLock' && typeof r.step.locks === 'number')
      locks.set(r.step.psycheLock, r.step.locks);
    if (r.type === 'breakLock') breaks++;
  }
  if (locks.size) lockRows.push([ep.key, locks.size, [...locks.values()].join('・'), breaks]);
}
console.log(table(['話', 'ロックの数', '錠の数', 'breakLock の数（分岐を含む）'], lockRows));

// 法廷パート
console.log('\n## 法廷パート\n');
const trialRows: (string | number)[][] = [];
const tacc: Record<
  string,
  { stmts: number[]; contra: number[]; hidden: number[]; press: number[]; perBlock: number[] }
> = {};
const penaltyWhere = new Counter<string>();
const hintSpeakers: Record<string, Counter<string>> = {};
for (const ep of eps) {
  const g = ep.game;
  const a = slot(tacc, g, () => ({ stmts: [], contra: [], hidden: [], press: [], perBlock: [] }));
  const perBlock = new Counter<string>();
  let choices = 0;
  let demands = 0;
  (ep.data.parts ?? []).forEach((p: Y, pi: number) => {
    for (const s of Object.values<Y>(p.scenes ?? {})) {
      if (Array.isArray(s) || !s.statements) continue;
      perBlock.add(ep.blockOf[pi] as string);
      a.stmts.push(s.statements.length);
      a.contra.push(
        s.statements.filter((x: Y) => x.present && Object.keys(x.present).length).length,
      );
      a.hidden.push(s.statements.filter((x: Y) => x.when).length);
      for (const st of s.statements) a.press.push(countLines(st.press, ep.characters));
    }
  });
  for (const r of walkEpisode(ep)) {
    if (r.ctx.kind !== 'trial') continue;
    if (r.type === 'choice') choices++;
    if (r.type === 'demand') demands++;
    if (r.type === 'penalty')
      penaltyWhere.add(
        `${g}:${r.ctx.where.find((w) => ['wrong', 'press', 'choice', 'demand.wrong', 'present', 'after', 'loop'].includes(w)) ?? 'その他'}`,
      );
    const l: Line | null = lineOf(r);
    if (l && (r.ctx.where[0] === 'after' || r.ctx.where[0] === 'loop')) {
      const c = slot(hintSpeakers, `${g}:${r.ctx.where[0]}`, () => new Counter<string>());
      c.add(
        l.speaker === null
          ? '（ナレーション）'
          : l.speaker === ep.data.player && l.color === 'blue'
            ? `${l.speaker}（心の声）`
            : l.speaker,
      );
    }
  }
  for (const n of perBlock.m.values()) a.perBlock.push(n);
  trialRows.push([
    ep.key,
    [...perBlock.m].map(([b, n]) => `${b} ${n}`).join('、'),
    choices,
    demands,
  ]);
}
console.log(
  '証言の数は証言のシーンの数（同じ証言の言い直し・追加の証言も 1 つに数える）。選択肢とつきつけの要求は分岐に写された分も含む。\n',
);
console.log(table(['話', '編ごとの証言の数', '選択肢', 'つきつけの要求'], trialRows));
console.log('\n### 作品ごと\n');
console.log(
  table(
    [
      '作品',
      '1 法廷編の証言',
      '1 証言の文',
      'つきつけの反応がある文',
      '条件で現れる文',
      '1 ゆさぶりの台詞',
    ],
    GAMES.map((g) => {
      const a = tacc[g];
      if (!a) return [GAME_NAME[g], '-', '-', '-', '-', '-'];
      return [GAME_NAME[g], mr(a.perBlock), mr(a.stmts), mr(a.contra), mr(a.hidden), dist(a.press)];
    }),
  ),
);
// 証言の文・題・選択肢の長さ
const stLen: number[] = [];
const titleLen: number[] = [];
const optN = new Counter<string>();
const optLen: number[] = [];
for (const ep of eps) {
  for (const p of ep.data.parts ?? [])
    for (const s of Object.values<Y>(p.scenes ?? {})) {
      if (Array.isArray(s) || !s.statements) continue;
      titleLen.push([...String(s.testimony)].length);
      for (const st of s.statements) stLen.push(parseText(st.text).chars);
    }
  for (const r of walkEpisode(ep))
    if (r.type === 'choice') {
      optN.add(`${r.step.choice.length} 択`);
      for (const o of r.step.choice) optLen.push([...String(o.text ?? '')].length);
    }
}
console.log('\n### 証言の文・題と選択肢の長さ（3 作）\n');
console.log(`- 証言の 1 文の文字数: ${dist(stLen)}`);
console.log(`- 証言の題の文字数: ${dist(titleLen)}`);
console.log(
  `- 選択肢の数: ${optN
    .top(4)
    .map(([k, n]) => `${k} ${pct(n, optN.total(), 0)}`)
    .join('、')}（分岐に写された分も含む）`,
);
console.log(`- 選択肢の文字数: ${dist(optLen)}`);
console.log('\n### ペナルティの入る所（YAML の入れ物）\n');
console.log(
  table(
    ['作品', '内訳'],
    GAMES.map((g) => {
      const items = [...penaltyWhere.m].filter(([k]) => k.startsWith(`${g}:`));
      const t = items.reduce((x, [, n]) => x + n, 0);
      return [
        GAME_NAME[g],
        items
          .sort((x, y) => y[1] - x[1])
          .map(([k, n]) => `${k.slice(4)} ${pct(n, t, 0)}`)
          .join('、'),
      ];
    }),
  ),
);
console.log('\n### 証言の後（after）と尋問の一巡（loop）で話す人物\n');
for (const g of GAMES)
  for (const w of ['after', 'loop']) {
    const c = hintSpeakers[`${g}:${w}`];
    if (!c) continue;
    console.log(
      `- ${GAME_NAME[g]} ${w}: ${c
        .top(6)
        .map(([k, n]) => `${k} ${pct(n, c.total(), 0)}`)
        .join('、')}`,
    );
  }
