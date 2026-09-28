// 演出の頻度の集計: 揺れ・フラッシュ・効果音・BGM・フェード・立ち絵の動き・吹き出しなど。
// 使い方: bun tools/analysis/effects.ts > 出力.md
// ここでは台詞も演出も、YAML に書かれた回数（分岐に写されたものも含む）で数える（割合をそろえるため）。

import { GAME_NAME, GAMES, lineOf, loadEpisodes, type StepRec, walkEpisode } from './corpus.ts';
import { playerOf, ShowTracker } from './fx.ts';
import { Counter, f, pct, table } from './stats.ts';
import { parseText } from './text.ts';

const eps = await loadEpisodes();
type Kind = 'investigation' | 'trial';
const key = (g: string, k: Kind) => `${g}:${k}`;
const lines = new Counter<string>();
const step = new Counter<string>(); // `${g}:${kind}:${名前}`
const detail = new Counter<string>(); // `${g}:${名前}`
const seCtx = new Map<string, Counter<string>>(); // `${g}:${id}` → 文脈
const bgmCtx = new Counter<string>(); // `${g}:${文脈}`
const recs: StepRec[] = [];

const near = (r: StepRec, type: string, d = 2) =>
  r.siblings
    .slice(Math.max(0, r.index - d), r.index + d + 1)
    .some((s, i) => i !== Math.min(d, r.index) && Object.keys(s)[0] === type);

for (const ep of eps) {
  const shows = new ShowTracker();
  for (const r of walkEpisode(ep)) {
    recs.push(r);
    const g = ep.game;
    const k = key(g, r.ctx.kind);
    const add = (name: string, n = 1) => step.add(`${k}:${name}`, n);
    const l = lineOf(r);
    if (l) {
      lines.add(k);
      for (const c of parseText(l.raw, l.color).commands) {
        if (c.name === 'show')
          add(
            shows.step(r.arrayId, c.args[0] === 'null' ? null : (c.args[0] ?? null)) === 'same'
              ? '文中show(動き替え)'
              : '文中show(人物替え)',
          );
        else if (
          c.name !== 'color' &&
          c.name !== 'blip' &&
          c.name !== 'native' &&
          c.name !== 'location'
        )
          add(`文中${c.name}`);
        if (c.name === 'shake') detail.add(`${g}:文中の揺れの強さ ${c.args[1] ?? '0'}`);
        if (c.name === 'flash') detail.add(`${g}:文中のフラッシュ ${c.args[0] ?? '白'}`);
        if (c.name === 'se') {
          const cx = seCtx.get(`${g}:${c.args[0]}`) ?? new Counter<string>();
          cx.add('合計');
          cx.add('文中');
          seCtx.set(`${g}:${c.args[0]}`, cx);
        }
      }
      continue;
    }
    const s = r.step;
    switch (r.type) {
      case 'shake':
        add('揺れ');
        detail.add(`${g}:揺れの強さ ${s.strength ?? 0}`);
        detail.add(`${g}:揺れの長さ ${s.shake === true ? 30 : s.shake}`);
        break;
      case 'flash':
        add('フラッシュ');
        detail.add(`${g}:フラッシュ ${s.flash === true ? '白' : s.flash}`);
        break;
      case 'se': {
        add('効果音');
        const cx = seCtx.get(`${g}:${s.se}`) ?? new Counter<string>();
        cx.add('合計');
        if (near(r, 'flash')) cx.add('フラッシュと');
        if (near(r, 'shake')) cx.add('揺れと');
        if (near(r, 'shout', 3)) cx.add('吹き出しと');
        if (near(r, 'showEvidence', 3) || near(r, 'give', 3)) cx.add('証拠品と');
        if (near(r, 'penalty', 3)) cx.add('ペナルティと');
        if (near(r, 'fade', 2)) cx.add('フェードと');
        cx.add(r.ctx.kind === 'trial' ? '法廷' : '探偵');
        seCtx.set(`${g}:${s.se}`, cx);
        break;
      }
      case 'bgm': {
        add(s.bgm === null ? 'BGM停止' : 'BGM切替');
        const w = r.ctx.where;
        const cx =
          s.bgm === null
            ? '止める'
            : w[0] === 'reading' || w[1] === 'before'
              ? '証言'
              : w[0] === 'enter'
                ? '場所に来たとき'
                : r.ctx.kind === 'trial'
                  ? '法廷のその他'
                  : '探偵のその他';
        bgmCtx.add(`${g}:${cx}:${s.bgm}`);
        break;
      }
      case 'bgmPause':
        add(s.bgmPause ? 'BGM一時停止' : 'BGM再開');
        break;
      case 'fade':
        add(s.fade === 'out' ? 'フェードアウト' : 'フェードイン');
        if (s.fade === 'out') detail.add(`${g}:フェードアウトの色 ${s.color ?? 'black'}`);
        break;
      case 'show':
        add(shows.step(r.arrayId, s.show ?? null) === 'same' ? 'show(動き替え)' : 'show(人物替え)');
        break;
      case 'shout':
        add(`吹き出し ${s.shout}`);
        detail.add(
          `${g}:吹き出し ${s.shout} ${(s.by ?? playerOf(r)) === playerOf(r) ? '主人公' : (s.by as string)}`,
        );
        break;
      case 'penalty':
      case 'showEvidence':
      case 'pan':
      case 'banner':
      case 'card':
      case 'give':
      case 'choice':
      case 'demand':
        add(r.type);
        break;
    }
  }
}

console.log('# 演出の集計\n');
console.log(
  '数は YAML に書かれた回数（分岐に写された分も含む）。「100 台詞あたり」は同じ数え方の台詞の数で割った値。\n',
);

const names = [
  '揺れ',
  '文中shake',
  'フラッシュ',
  '文中flash',
  '効果音',
  '文中se',
  'BGM切替',
  '文中bgm',
  'BGM停止',
  'BGM一時停止',
  'BGM再開',
  'フェードアウト',
  'show(人物替え)',
  'show(動き替え)',
  '文中show(人物替え)',
  '文中show(動き替え)',
  'pan',
  '吹き出し objection',
  '吹き出し hold',
  '吹き出し takethat',
  'penalty',
  'showEvidence',
  'give',
  'card',
  'banner',
  'choice',
  'demand',
];
for (const kind of ['trial', 'investigation'] as Kind[]) {
  console.log(`## ${kind === 'trial' ? '法廷' : '探偵'}パートの 100 台詞あたりの回数\n`);
  console.log(
    table(
      ['演出', ...GAMES.map((g) => GAME_NAME[g])],
      names.map((n) => [
        n,
        ...GAMES.map((g) => {
          const c = step.get(`${key(g, kind)}:${n}`);
          return `${f((c / lines.get(key(g, kind))) * 100)}（${c}）`;
        }),
      ]),
    ),
  );
  console.log(
    `\n台詞の数: ${GAMES.map((g) => `${GAME_NAME[g]} ${lines.get(key(g, kind))}`).join('、')}\n`,
  );
}

console.log('## 強さ・色・長さの内訳\n');
for (const prefix of [
  '揺れの強さ',
  '揺れの長さ',
  '文中の揺れの強さ',
  'フラッシュ',
  '文中のフラッシュ',
  'フェードアウトの色',
  '吹き出し',
]) {
  const rows: string[][] = [];
  for (const g of GAMES) {
    const items = [...detail.m]
      .filter(([k]) => k.startsWith(`${g}:${prefix} `))
      .sort((a, b) => b[1] - a[1]);
    const tot = items.reduce((a, [, n]) => a + n, 0);
    rows.push([
      GAME_NAME[g],
      items
        .slice(0, 8)
        .map(([k, n]) => `${k.slice(g.length + prefix.length + 2)} ${pct(n, tot, 0)}`)
        .join('、'),
    ]);
  }
  console.log(`### ${prefix}\n`);
  console.log(table(['作品', '内訳'], rows));
  console.log();
}

console.log('## 効果音（作品ごとに多い順）\n');
console.log('番号は作品ごとの SDAT の名前（作品が違うと同じ番号でも別の音のことがある）。');
console.log('「フラッシュと」などは、前後 2〜3 ステップの中にそのステップがある割合。\n');
for (const g of GAMES) {
  const items = [...seCtx]
    .filter(([k]) => k.startsWith(`${g}:`))
    .sort((a, b) => b[1].get('合計') - a[1].get('合計'));
  console.log(`### ${GAME_NAME[g]}\n`);
  console.log(
    table(
      [
        '音',
        '回数',
        '文中',
        'フラッシュと',
        '揺れと',
        '吹き出しと',
        '証拠品と',
        'ペナルティと',
        '法廷',
      ],
      items.slice(0, 14).map(([k, c]) => {
        const t = c.get('合計');
        return [
          k.slice(g.length + 1),
          t,
          pct(c.get('文中'), t, 0),
          pct(c.get('フラッシュと'), t, 0),
          pct(c.get('揺れと'), t, 0),
          pct(c.get('吹き出しと'), t, 0),
          pct(c.get('証拠品と'), t, 0),
          pct(c.get('ペナルティと'), t, 0),
          pct(c.get('法廷'), t - c.get('文中'), 0),
        ];
      }),
    ),
  );
  console.log();
}

console.log('## BGM の切り替えの場面\n');
for (const g of GAMES) {
  const byCtx = new Map<string, Counter<string>>();
  for (const [k, n] of bgmCtx.m) {
    if (!k.startsWith(`${g}:`)) continue;
    const [, cx = '', id = ''] = k.split(':');
    const c = byCtx.get(cx) ?? new Counter<string>();
    c.add(id, n);
    byCtx.set(cx, c);
  }
  console.log(`### ${GAME_NAME[g]}\n`);
  console.log(
    table(
      ['場面', '回数', '多い曲（回数）'],
      [...byCtx].map(([cx, c]) => [
        cx,
        c.total(),
        c
          .top(4)
          .map(([id, n]) => `${id}（${n}）`)
          .join('、'),
      ]),
    ),
  );
  console.log();
}
console.error(`ステップ ${recs.length}`);
