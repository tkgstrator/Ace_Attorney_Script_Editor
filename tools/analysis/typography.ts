// 文字の使い方の集計: 文中コマンド、色、句読点と「‥‥」、改行の位置、ページの終わり方。
// 使い方: bun tools/analysis/typography.ts > 出力.md
// 台詞は同じ話の重複を除いて数える（volume.ts と同じ）。

import {
  GAME_NAME,
  GAMES,
  type Line,
  lineOf,
  loadEpisodes,
  uniqueLines,
  walkEpisode,
} from './corpus.ts';
import { Counter, dist, f, pct, slot, table } from './stats.ts';
import { countMatches, MARKS, parseText } from './text.ts';

const eps = await loadEpisodes();
const byGame: Record<string, Line[]> = {};
for (const ep of eps) {
  const ls: Line[] = [];
  for (const r of walkEpisode(ep)) {
    const l = lineOf(r);
    if (l) ls.push(l);
  }
  slot(byGame, ep.game, () => [] as Line[]).push(...uniqueLines(ls));
}

/** 文字をまとめた分類（直前の文字の種類を見るため） */
const prevClass = (c: string | undefined): string => {
  if (c === undefined) return '行頭';
  if (/[、,]/.test(c)) return '、';
  if (/[。]/.test(c)) return '。';
  if (/[!！]/.test(c)) return '！';
  if (/[?？]/.test(c)) return '？';
  if (/‥/.test(c)) return '‥';
  if (/[）」”』]/.test(c)) return '閉じ括弧';
  return 'その他の文字';
};

console.log('# 文字の使い方の集計\n');

console.log('## 文中コマンドの頻度（100 台詞あたりの回数 / 1 回以上使う台詞の割合）\n');
const cmdNames = ['wait', 'speed', 'color', 'shake', 'flash', 'se', 'show', 'bgm', 'blip'];
console.log(
  table(
    ['コマンド', ...GAMES.map((g) => GAME_NAME[g])],
    cmdNames.map((n) => [
      n,
      ...GAMES.map((g) => {
        const ls = byGame[g] ?? [];
        let c = 0;
        let has = 0;
        for (const l of ls) {
          const k = parseText(l.raw, l.color).commands.filter((x) => x.name === n).length;
          c += k;
          if (k) has++;
        }
        return `${f((c / ls.length) * 100)} / ${pct(has, ls.length, 0)}`;
      }),
    ]),
  ),
);

for (const g of GAMES) {
  const ls = byGame[g] ?? [];
  const waitVal = new Counter<string>();
  const waitAfter = new Map<string, number[]>();
  const speedVal = new Counter<string>();
  const speedCtx = new Counter<string>();
  const colorChars = new Counter<string>();
  const colorWho = new Map<string, Counter<string>>();
  const redLen: number[] = [];
  const redCtx = new Counter<string>();
  const marks = new Counter<string>();
  let chars = 0;
  const pageEnd = new Counter<string>();
  const breakAt = new Counter<string>();
  let blueMulti = 0;
  let blueIndent = 0;
  let blueParen = 0;
  let blueLines = 0;
  const dots = new Counter<string>();
  let fullBang = 0;
  let halfBang = 0;

  for (const l of ls) {
    const p = parseText(l.raw, l.color);
    const flat = p.plain.replace(/\n/g, '');
    chars += p.chars;
    for (const [name, re] of Object.entries(MARKS)) marks.add(name, countMatches(flat, re));
    fullBang += countMatches(flat, /！/g);
    halfBang += countMatches(flat, /!/g);
    for (const m of flat.matchAll(/‥+/g)) {
      const pos = m.index === 0 ? '文頭' : m.index + m[0].length === flat.length ? '文末' : '文中';
      dots.add(`${m[0].length} 字・${pos}`);
    }
    for (const c of p.commands) {
      if (c.name === 'wait') {
        const v = Number(c.args[0]);
        waitVal.add(
          v >= 60 ? '60+' : v >= 30 ? '30〜59' : v >= 15 ? '15〜29' : v >= 8 ? '8〜14' : '1〜7',
        );
        const k = c.pos === 0 ? '行頭' : prevClass(flat[c.pos - 1]);
        const arr = waitAfter.get(k) ?? [];
        arr.push(v);
        waitAfter.set(k, arr);
      }
      if (c.name === 'speed') {
        const v = Number(c.args[0]);
        speedVal.add(String(v));
        const next = flat.slice(c.pos, c.pos + 2);
        speedCtx.add(
          `${v > 3 ? '遅く' : v < 3 ? '速く' : '標準'}:${c.pos === 0 ? '台詞の頭' : '途中'}${next.startsWith('‥') ? '・‥‥の前' : ''}`,
        );
      }
    }
    // 色
    let run = '';
    let runColor = '';
    let runStart = 0;
    const flush = () => {
      if (runColor === 'red' && run) {
        redLen.push(run.length);
        redCtx.add(l.color === 'blue' ? '心の声の中' : '心の声の外');
        if (/[“《「]/.test(flat[runStart - 1] ?? '') || /^[“《「]/.test(run))
          redCtx.add('括弧（“”《》「」）で囲む');
        if (/[0-9０-９]/.test(run)) redCtx.add('数字を含む');
      }
      run = '';
    };
    p.colors.forEach((c, i) => {
      colorChars.add(c);
      if (c !== runColor) {
        flush();
        runColor = c;
        runStart = i;
      }
      run += flat[i];
    });
    flush();
    const used = new Set(p.colors);
    for (const c of used) {
      if (c === 'white') continue;
      const who =
        l.speaker === null
          ? '（名前なし）'
          : l.speaker === l.rec.ctx.ep.data.player
            ? '主人公'
            : l.speaker;
      const cc = colorWho.get(c) ?? new Counter<string>();
      cc.add(who);
      colorWho.set(c, cc);
    }
    // 改行とページの終わり
    const last = flat.at(-1);
    pageEnd.add(prevClass(last));
    if (p.lines.length >= 2) breakAt.add(prevClass(p.lines[0]?.at(-1)));
    if (l.color === 'blue' && l.speaker) {
      blueLines++;
      if (flat.startsWith('（')) blueParen++;
      if (p.lines.length >= 2) {
        blueMulti++;
        if (p.lines[1]?.startsWith('　')) blueIndent++;
      }
    }
  }

  console.log(`\n## ${GAME_NAME[g]}\n`);
  console.log(`台詞 ${ls.length}、文字 ${chars}\n`);
  console.log('### wait の長さ（フレーム）\n');
  console.log(
    table(
      ['長さ', '割合'],
      [...waitVal.m].sort().map(([k, n]) => [k, pct(n, waitVal.total(), 0)]),
    ),
  );
  console.log('\n### wait の直前の文字と、長さの中央値\n');
  console.log(
    table(
      ['直前', '割合', '長さ'],
      [...waitAfter]
        .sort((a, b) => b[1].length - a[1].length)
        .map(([k, v]) => [k, pct(v.length, waitVal.total(), 0), dist(v)]),
    ),
  );
  console.log('\n### speed の値（既定 3。大きいほど遅い）\n');
  console.log(
    table(
      ['値', '割合'],
      speedVal.top(8).map(([k, n]) => [k, pct(n, speedVal.total(), 0)]),
    ),
  );
  console.log(
    `\n使い方: ${speedCtx
      .top(8)
      .map(([k, n]) => `${k} ${pct(n, speedCtx.total(), 0)}`)
      .join('、')}\n`,
  );
  console.log('### 色（文字数の割合と、その色を使う話し手）\n');
  console.log(
    table(
      ['色', '文字の割合', '多い話し手'],
      colorChars
        .top(6)
        .map(([c, n]) => [
          c,
          pct(n, colorChars.total()),
          (colorWho.get(c)?.top(5) ?? [])
            .map(([w, k]) => `${w} ${pct(k, colorWho.get(c)?.total() ?? 0, 0)}`)
            .join('、'),
        ]),
    ),
  );
  console.log(`\n赤字のひとかたまりの長さ: ${dist(redLen)}\n`);
  console.log(
    `赤字のかたまり ${redLen.length} の内訳: ${redCtx
      .top(4)
      .map(([k, n]) => `${k} ${pct(n, redLen.length, 0)}`)
      .join('、')}\n`,
  );
  console.log('### 記号（100 字あたり）\n');
  console.log(
    table(
      ['記号', '100 字あたり'],
      [...marks.m].map(([k, n]) => [k, f((n / chars) * 100, 2)]),
    ),
  );
  console.log(`\n感嘆符の全角「！」と半角「!」: ${fullBang} / ${halfBang}\n`);
  console.log(
    `「‥」の続く長さと位置: ${dots
      .top(8)
      .map(([k, n]) => `${k} ${pct(n, dots.total(), 0)}`)
      .join('、')}\n`,
  );
  console.log(
    `ページ（台詞）の最後の文字: ${pageEnd
      .top(8)
      .map(([k, n]) => `${k} ${pct(n, ls.length, 0)}`)
      .join('、')}\n`,
  );
  console.log(
    `2 行の台詞の 1 行目の終わり: ${breakAt
      .top(8)
      .map(([k, n]) => `${k} ${pct(n, breakAt.total(), 0)}`)
      .join('、')}\n`,
  );
  console.log(
    `心の声（主人公などの青字の台詞 ${blueLines}）: 「（」で始まる ${pct(blueParen, blueLines, 0)}、2 行のとき 2 行目を全角空白で下げる ${pct(blueIndent, blueMulti, 0)}\n`,
  );
}
