// 決まり文句（手続きの定型句）の集計。docs/writing/trial/phrases.md・investigation/phrases.md の数の出どころ。
// 使い方: bun tools/analysis/phrases.ts > 出力.md（all.ts が docs/writing/numbers/phrases.md に書く）
// 数えるもの:
// - phrases-list.ts の句ごとに、当たる台詞の数（重複を除いた数え方。README の「数え方の決まり」）・話の数・作品の数・主な話し手
// - 吹き出し（YAML に書かれた shout）・判決の大きな文字（banner）・日時の表示（card）の 1 行目の形
// - 許可リスト（stock-phrases.json）の句ごとの話の数・話し手の数と、基準（下の STOCK_RULE）を満たすか
// 出力には、句（短い定型句）と数だけが入る。

import {
  baseId,
  type Episode,
  type Line,
  lineOf,
  loadEpisodes,
  uniqueLines,
  walkEpisode,
} from './corpus.ts';
import { PHRASES } from './phrases-list.ts';
import { Counter, table } from './stats.ts';
import { loadStockPhrases, stockRegex } from './stock.ts';

/**
 * 許可リストの基準: 3 話以上、2 人以上の話し手。
 * 裁判長だけが言う手続きの句と、名前なしの知らせ・日時の表示は、話し手が 1 人（か無し）に決まっているので、2 作品以上で代える。
 */
const STOCK_RULE = { episodes: 3, speakers: 2, gamesIfJudgeOnly: 2 };

const eps = await loadEpisodes();

function norm(s: string): string {
  return s
    .replace(/\[\[/g, '[')
    .replace(/\[[a-zA-Z][^\]]*\]/g, '')
    .replace(/[\s　]/g, '');
}

function speakerName(ep: Episode, id: string | null): string {
  if (!id) return '（名前なし）';
  const b = baseId(id);
  for (const k of [b, id]) {
    const name = ep.data.characters?.[k]?.name;
    if (typeof name === 'string') return name;
  }
  return b;
}

interface Rec {
  line: Line;
  text: string;
  speaker: string;
  name: string;
}

const recs: Rec[] = [];
const cards: Rec[] = [];
const steps: { ep: Episode; type: string; step: Record<string, unknown> }[] = [];
/** 証拠品・人物ファイルを加える・外すステップ（編の種類ごと）と、give の後 3 ステップ以内に名前なしの青字の知らせがあるか */
const files = {
  give: new Counter<string>(),
  notice: new Counter<string>(),
  profile: new Counter<string>(),
};
/** 探偵パートの日時の表示が、場所に来たとき（enter）にあるか */
const invCards = new Counter<string>();
for (const ep of eps) {
  const ls: Line[] = [];
  for (const r of walkEpisode(ep)) {
    if (r.type === 'give') {
      files.give.add(r.ctx.kind);
      const next = r.siblings.slice(r.index + 1, r.index + 4);
      if (next.some((x) => x && x.say === null && x.color === 'blue')) files.notice.add(r.ctx.kind);
    }
    if (r.type === 'giveProfile' || r.type === 'takeProfile') files.profile.add(r.type);
    if (r.type === 'card' && r.ctx.kind === 'investigation')
      invCards.add(
        r.ctx.scene.startsWith('place:') && r.ctx.where[0] === 'enter' ? 'enter' : 'other',
      );
    const l = lineOf(r);
    if (l) ls.push(l);
    else if (['shout', 'banner', 'card'].includes(r.type)) {
      steps.push({ ep, type: r.type, step: r.step });
      // 日時の表示も、許可リストの確かめのために文として数える（話し手は「日時の表示」）
      if (r.type === 'card' && typeof r.step.card === 'string') {
        const line: Line = { rec: r, speaker: null, raw: r.step.card, color: 'green', auto: false };
        cards.push({ line, text: norm(r.step.card), speaker: '(card)', name: '日時の表示' });
      }
    }
  }
  for (const l of uniqueLines(ls))
    recs.push({
      line: l,
      text: norm(l.raw),
      speaker: l.speaker ? baseId(l.speaker) : '',
      name: speakerName(ep, l.speaker),
    });
}

interface Tally {
  n: number;
  eps: Set<string>;
  games: Set<string>;
  speakers: Set<string>;
  names: Counter<string>;
}

function tally(match: (r: Rec) => boolean, withCards = false): Tally {
  const t: Tally = {
    n: 0,
    eps: new Set(),
    games: new Set(),
    speakers: new Set(),
    names: new Counter(),
  };
  for (const r of withCards ? [...recs, ...cards] : recs) {
    if (!match(r)) continue;
    t.n++;
    t.eps.add(r.line.rec.ctx.ep.key);
    t.games.add(r.line.rec.ctx.ep.game);
    t.speakers.add(r.speaker);
    t.names.add(r.name);
  }
  return t;
}

const top = (c: Counter<string>) =>
  c
    .top(3)
    .map(([k, v]) => `${k} ${v}`)
    .join('、');

const out: string[] = [];
out.push('# 決まり文句の集計', '');
out.push(
  '台詞（重複を除いた数え方）のうち、文中コマンドと空白を除いた文が句の形に当たるものの数。',
  '「話」は当たる台詞のある話の数（14 話のうち）、「作品」は 3 作のうちの数。句の ○○ は名前などが入る所。',
  '句は定型句の代表の形で、数には言い回しの小さな違い（「しております」「しています」など）も入る。',
  '',
);

for (const [part, title] of [
  ['trial', '法廷パート'],
  ['investigation', '探偵パート'],
] as const) {
  out.push(`## ${title}`, '');
  const rows: string[][] = [];
  for (const p of PHRASES.filter((x) => x.part === part)) {
    const t = tally((r) => r.line.rec.ctx.kind === part && p.re.test(r.text));
    rows.push([
      p.scene,
      p.phrase,
      String(t.n),
      String(t.eps.size),
      String(t.games.size),
      top(t.names),
    ]);
  }
  out.push(table(['場面', '句', '台詞', '話', '作品', '主な話し手'], rows), '');
}

// 吹き出し・判決・日時の表示
const shout = new Counter<string>();
const banner = new Counter<string>();
const card = new Counter<string>();
for (const s of steps) {
  if (s.type === 'shout')
    shout.add(
      `${s.step.shout}（${speakerName(s.ep, typeof s.step.by === 'string' ? s.step.by : null)}）`,
    );
  if (s.type === 'banner' && typeof s.step.banner === 'string') banner.add(norm(s.step.banner));
  if (s.type === 'card' && typeof s.step.card === 'string') {
    const first = norm(s.step.card.replace(/\n[\s\S]*/, '')).replace(/[0-9０-９]+/g, 'N');
    if (/N/.test(first)) card.add(first);
  }
}
const kinds = new Counter<string>();
for (const s of steps) if (s.type === 'shout') kinds.add(String(s.step.shout));
const kindText = kinds
  .top(5)
  .map(([k, v]) => `${k} ${v}`)
  .join('、');
out.push('## YAML に書かれた吹き出し（shout と by）', '');
out.push(`合計: ${kindText}（takethat は YAML に無い。つきつけの要求の後にエンジンが出す）`, '');
out.push(
  table(
    ['吹き出しと人物', '数'],
    shout.top(12).map(([k, v]) => [k, String(v)]),
  ),
  '',
);
out.push('## 証拠品と人物ファイルを加える所', '');
out.push(
  table(
    ['編', 'give', 'うち 3 ステップ以内に名前なしの青字の知らせ'],
    (['trial', 'investigation'] as const).map((k) => [
      k === 'trial' ? '法廷' : '探偵',
      String(files.give.get(k)),
      String(files.notice.get(k)),
    ]),
  ),
  '',
  `人物ファイル: giveProfile ${files.profile.get('giveProfile')}、takeProfile ${files.profile.get('takeProfile')}（知らせの文は出さない）`,
  '',
);
out.push('## 判決の大きな文字（banner）', '');
out.push(
  table(
    ['文字', '数'],
    banner.top(5).map(([k, v]) => [k, String(v)]),
  ),
  '',
);
out.push('## 日時の表示（card）の 1 行目の形', '', '数字は N にした。', '');
out.push(
  table(
    ['形', '数'],
    card.top(10).map(([k, v]) => [k, String(v)]),
  ),
  '',
);
out.push(
  `探偵パートの日時の表示 ${invCards.total()} のうち、場所に来たとき（enter）の中にあるもの ${invCards.get('enter')}。`,
  '',
);

// 許可リストの確かめ
out.push('## 許可リスト（tools/analysis/stock-phrases.json）の確かめ', '');
out.push(
  `基準: ${STOCK_RULE.episodes} 話以上、話し手 ${STOCK_RULE.speakers} 人以上。裁判長だけが言う句と、名前なしの知らせ・日時の表示は、話し手の代わりに作品 ${STOCK_RULE.gamesIfJudgeOnly} つ以上。`,
  '',
);
const bad: string[] = [];
const rows: string[][] = [];
for (const s of loadStockPhrases()) {
  const re = stockRegex(s.phrase);
  const t = tally((r) => {
    re.lastIndex = 0;
    return re.test(r.text);
  }, true);
  const judgeOnly =
    t.speakers.size === 1 && [...t.speakers].every((x) => ['judge', '', '(card)'].includes(x));
  const ok =
    t.eps.size >= STOCK_RULE.episodes &&
    (t.speakers.size >= STOCK_RULE.speakers ||
      (judgeOnly && t.games.size >= STOCK_RULE.gamesIfJudgeOnly));
  if (!ok) bad.push(s.phrase);
  rows.push([
    s.phrase,
    String(t.n),
    String(t.eps.size),
    String(t.games.size),
    String(t.speakers.size),
    ok ? '○' : '×',
  ]);
}
out.push(table(['句', '台詞', '話', '作品', '話し手', '基準'], rows), '');
console.log(out.join('\n'));
if (bad.length) {
  console.error(`許可リストの基準を満たさない句: ${bad.join(' / ')}`);
  process.exit(1);
}
