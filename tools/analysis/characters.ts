// 人物ごとの話し方の数値を docs/characters/<人物ID>.md に書き出す。
// 使い方: bun tools/analysis/characters.ts [--min 80] [--dry]
// ファイルの「<!-- auto:start -->」〜「<!-- auto:end -->」の間だけを書き換え、手で書いた所（その前後）は残す。
// 無いファイルはテンプレートで作る。docs/characters/README.md の一覧も同じく印の間を書き換える。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { type CharStats, collect, NOT_PERSON } from './charstats.ts';
import { type Episode, GAME_NAME, type Game, loadEpisodes } from './corpus.ts';
import { type Counter, f, median, pct, table } from './stats.ts';

const args = process.argv.slice(2);
const MIN = Number(args[args.indexOf('--min') + 1] || 80) || 80;
const DRY = args.includes('--dry');
const DIR = process.env.CHAR_DIR ?? join(import.meta.dir, '../../docs/characters');
const START = '<!-- auto:start（tools/analysis/characters.ts が書く。手で直さない） -->';
const END = '<!-- auto:end -->';

const eps = await loadEpisodes();
const epByKey = new Map<string, Episode>(eps.map((e) => [e.key, e]));
const { stats, all } = collect(eps);
const targets = [...stats.values()]
  .filter((s) => s.lines >= MIN && !NOT_PERSON.test(s.id))
  .sort((a, b) => b.lines - a.lines);

const lift = (c: Counter<string>, base: Counter<string>, k: string) =>
  c.get(k) / c.total() / (base.get(k) / base.total() || 1e-9);

/** 名札や人物ファイルの名前が役に合わないもの */
const NAME: Record<string, string> = {
  judge: '裁判長',
  mia: '綾里 千尋',
  dahlia: '美柳 ちなみ',
  morgan: '綾里 キミ子',
  uncle: '貸しボート屋のオヤジ',
  penny: '撮影所のスタッフ',
  godot: 'ゴドー',
};

function nameOf(s: CharStats): string {
  if (NAME[s.id]) return NAME[s.id] as string;
  const ns = [...s.names2].filter((n) => !/？/.test(n));
  return ns.sort((a, b) => b.length - a.length)[0] ?? [...s.names2][0] ?? s.id;
}

function listRate(c: Counter<string>, lines: number, n: number, min = 1): string {
  const items = c.top(n).filter(([, k]) => k >= min);
  if (!items.length) return 'なし';
  return items.map(([k, v]) => `${k} ${v}（${f((v / lines) * 100)}）`).join('、');
}

function distinctive(
  s: CharStats,
  c: Counter<string>,
  base: Counter<string>,
  n: number,
  min: number,
): string {
  const items = [...c.m]
    .filter(([k, v]) => v >= min && lift(c, base, k) >= 2)
    .sort((a, b) => b[1] * Math.log(lift(c, base, b[0])) - a[1] * Math.log(lift(c, base, a[0])))
    .slice(0, n);
  if (!items.length) return 'なし';
  return items.map(([k, v]) => `${k} ${v}（${f(lift(c, base, k))} 倍）`).join('、');
}

function render(s: CharStats): string {
  const out: string[] = [];
  const L = s.lines;
  out.push('### 登場作品と話\n');
  out.push(
    table(
      ['話', '題', '台詞'],
      [...s.perEp.m].map(([k, n]) => {
        const e = epByKey.get(k) as Episode;
        return [`${GAME_NAME[e.game as Game]} 第${e.ep}話`, e.title, n];
      }),
    ),
  );
  out.push('\n### 台詞の量\n');
  const inEps = [...s.perEp.m].reduce((a, [k]) => a + (all.perEp.get(k) || 0), 0);
  out.push(`- 台詞 ${L}（出てくる話の台詞の ${pct(L, inEps)}）、文字 ${s.chars}`);
  out.push(
    `- 探偵パート ${pct(s.kind.get('investigation'), L, 0)}・法廷パート ${pct(s.kind.get('trial'), L, 0)}`,
  );
  out.push(
    `- 場面: ${s.where
      .top(8)
      .map(([k, n]) => `${k} ${pct(n, L, 0)}`)
      .join('、')}`,
  );
  out.push(
    `- よく言葉を交わす相手（台詞が隣り合う回数）: ${s.partners
      .top(6)
      .map(([k, n]) => `${k} ${n}`)
      .join('、')}`,
  );
  out.push('\n### 一人称・二人称・呼び方\n');
  out.push('（ ）の中は 100 台詞あたりの回数。心の声（青字）の台詞は除く。\n');
  out.push(`- 一人称: ${listRate(s.first, L, 6, 2)}`);
  out.push(`- 二人称: ${listRate(s.second, L, 6, 2)}`);
  out.push(`- 名前・肩書きの呼び方（敬称つきなど）: ${listRate(s.names, L, 10, 3)}`);
  out.push('\n### 語尾・口癖\n');
  out.push(
    '文末（「。」「！」「？」「‥」の前か、ページの終わり）のかなの並び。「倍」は 3 作全体の台詞と比べた出やすさ。\n',
  );
  out.push(
    `- 多い文末の 1 字: ${s.end1
      .top(8)
      .map(([k, n]) => `${k} ${pct(n, s.end1.total(), 0)}`)
      .join('、')}`,
  );
  out.push(
    `- 多い文末（3 字まで）: ${s.end3
      .top(10)
      .map(([k, n]) => `${k} ${n}`)
      .join('、')}`,
  );
  out.push(
    `- 目立つ文末（全体より 2 倍以上出やすいもの）: ${distinctive(s, s.end3, all.end3, 8, 5)}`,
  );
  out.push(
    `- ページの頭の言葉（かなだけで 5 字まで）: ${
      s.heads
        .top(10)
        .filter(([, n]) => n >= 3)
        .map(([k, n]) => `${k} ${n}`)
        .join('、') || 'なし'
    }`,
  );
  out.push(
    `- よく使うカタカナ語（3 字以上、全体より 2 倍以上）: ${distinctive(s, s.kata, all.kata, 10, 3)}`,
  );
  out.push('\n### 文の長さ\n');
  const allMed = median(all.lens);
  out.push(
    `- 1 ページの文字数: 中央 ${f(median(s.lens))}（全体 ${f(allMed)}）、2 行のページ ${pct(s.pages2, L, 0)}（全体 ${pct(all.pages2, all.lines, 0)}）`,
  );
  out.push('\n### よく使う記号\n');
  out.push('100 字あたりの回数（全体との比）。\n');
  const markRow = (k: string) => {
    const r = (s.marks.get(k) / s.chars) * 100;
    const b = (all.marks.get(k) / all.chars) * 100;
    return `${k} ${f(r, 2)}（${f(r / b)} 倍）`;
  };
  out.push(`- ${['！', '？', '‥‥', 'ッ', 'ー', '、', '“”', '〜'].map(markRow).join('、')}`);
  out.push(`- 文字の種類: ${['漢字', 'カタカナ'].map(markRow).join('、')}`);
  out.push('\n### 感情の出し方（演出）\n');
  out.push('台詞の直前（前の台詞より後）か台詞の中に、その演出がある台詞の割合（全体の割合）。\n');
  const fxRow = (k: string) =>
    `${k} ${pct(s.fx.get(k), L, 0)}（${pct(all.fx.get(k), all.lines, 0)}）`;
  out.push(
    `- ${['揺れ', 'フラッシュ', '効果音', 'BGM一時停止の直後', '遅い文字送り', '速い文字送り'].map(fxRow).join('、')}`,
  );
  out.push(
    `- 1 台詞あたりの wait: ${f(s.fx.get('wait') / L, 2)}（全体 ${f(all.fx.get('wait') / all.lines, 2)}）`,
  );
  out.push('\n### 文字の色\n');
  out.push(
    `- 青字（心の声など）の台詞 ${pct(s.colorLines.get('blue'), L)}、緑字で始まる台詞 ${pct(s.colorLines.get('green'), L)}`,
  );
  out.push(
    `- 赤字の文字 ${pct(s.colorChars.get('red'), s.chars, 2)}（全体 ${pct(all.colorChars.get('red'), all.chars, 2)}）`,
  );
  out.push('\n### 立ち絵の動き\n');
  out.push(
    `- 同じ人物のまま動きを替える show（文中の show も含む）: 100 台詞あたり ${f((s.showSame / Math.max(1, s.rawLines)) * 100)}`,
  );
  out.push(
    `- 人物が入れ替わって出てくる show: 100 台詞あたり ${f((s.showSwitchIn / Math.max(1, s.rawLines)) * 100)}`,
  );
  out.push(`- 使われた動きの番号の数（作品ごとの番号の種類）: ${s.poses.size}`);
  if (s.stand.size) out.push(`- 立ち位置: ${[...s.stand].join('、')}`);
  return out.join('\n');
}

function template(s: CharStats): string {
  return `# ${nameOf(s)}（${s.id}）

（役どころと話し方の芯を 2〜3 行で）

## 数で見る

${START}
${END}

## 話し方の特徴

## 感情の出し方

## 登場する場面の型

## 書くときの注意

- らしい:
- らしくない:
`;
}

function replaceAuto(text: string, body: string): string {
  const a = text.indexOf(START);
  const b = text.indexOf(END);
  if (a < 0 || b < 0) throw new Error('auto の印が見つからない');
  return `${text.slice(0, a + START.length)}\n\n${body}\n\n${text.slice(b)}`;
}

if (!DRY) mkdirSync(DIR, { recursive: true });
for (const s of targets) {
  const path = join(DIR, `${s.id}.md`);
  const text = existsSync(path) ? readFileSync(path, 'utf8') : template(s);
  const next = replaceAuto(text, render(s));
  if (DRY) console.log(`${s.id}\t${s.lines}\t${nameOf(s)}`);
  else writeFileSync(path, next);
}

// README の一覧
const readme = join(DIR, 'README.md');
const list = table(
  ['人物', 'ID', '台詞', '作品'],
  targets.map((s) => [
    `[${nameOf(s)}](${s.id}.md)`,
    s.id,
    s.lines,
    [
      ...new Set([...s.perEp.m].map(([k]) => GAME_NAME[(epByKey.get(k) as Episode).game as Game])),
    ].join('・'),
  ]),
);
if (!DRY && existsSync(readme))
  writeFileSync(readme, replaceAuto(readFileSync(readme, 'utf8'), list));
console.error(`対象 ${targets.length} 人（台詞 ${MIN} 以上）`);
