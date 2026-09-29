// docs/characters/<人物ID>.md の手書きの部分にある数を、同じファイルの自動の部分（auto の印の間）と突き合わせる。
// 使い方: bun tools/analysis/check-characters.ts [人物ID ...]
// 自動の部分を作り直した後（bun tools/analysis/all.ts）に流し、食い違いを 1 行ずつ出す。食い違いがあれば終了コード 1。
// 見るもの:
//   - 「語」の後の（数）・（数 倍）・「語」も 数 倍: 自動の部分に同じ語があれば、その数が自動の部分の数に含まれるか。
//   - 揺れ・フラッシュなどの演出の割合（数%）。
//   - 「第N話」の後の「数 台詞」: 登場作品と話の表の台詞の数と合うか（作品名は同じ行の直前のものを使う）。
//   - 年齢の表の「公式」の値: 自動の部分の人物ファイルの年齢に含まれるか。
// 自動の部分に無い語（上位に入らない呼び方など）は確かめられないので飛ばす。

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = process.env.CHAR_DIR ?? join(import.meta.dir, '../../docs/characters');
const START = /<!-- auto:start[^>]*-->/;
const END = '<!-- auto:end -->';
const FX = ['揺れ', 'フラッシュ', '効果音', 'BGM一時停止の直後', '遅い文字送り', '速い文字送り'];
/** --unknown: 自動の部分に無い語の数も一覧にする（手で確かめるため。食い違いには数えない） */
const UNKNOWN = process.argv.includes('--unknown');
const GAME = /(蘇る逆転|逆転裁判2|逆転裁判3)/g;

const nums = (s: string): string[] => s.match(/\d+(?:\.\d+)?/g) ?? [];
/** 1.0 と 1 のような書き方の違いをそろえる */
const norm = (n: string) => String(Number(n));

export interface Auto {
  /** 語 → 自動の部分でその語と並んで出た数 */
  items: Map<string, Set<string>>;
  /** '蘇る逆転 第3話' → 台詞の数 */
  episodes: Map<string, number>;
  /** 人物ファイルの年齢（自動の部分の年齢の表） */
  ages: Set<string>;
}

export function parseAuto(body: string): Auto {
  const items = new Map<string, Set<string>>();
  const episodes = new Map<string, number>();
  const ages = new Set<string>();
  const add = (label: string, ns: string[]) => {
    const set = items.get(label) ?? new Set<string>();
    for (const n of ns) set.add(norm(n));
    items.set(label, set);
  };
  let section = '';
  for (const line of body.split('\n')) {
    if (line.startsWith('### ')) section = line.slice(4);
    const row = line.match(/^\| ((?:蘇る逆転|逆転裁判2|逆転裁判3) 第\d話) \| [^|]* \| (\d+) \|$/);
    if (row && section.startsWith('登場作品と話')) episodes.set(row[1] as string, Number(row[2]));
    const age = line.match(/^\|[^|]*\|[^|]*\| (\d+) \|$/);
    if (section.startsWith('人物ファイルの年齢') && age) ages.add(norm(age[1] as string));
    if (!line.startsWith('- ')) continue;
    const colon = line.indexOf(': ');
    const rest = colon >= 0 ? line.slice(colon + 2) : line.slice(2);
    for (const item of rest.split('、')) {
      const m = item.match(/^(.+?) (\d[\d.]*%?.*)$/);
      if (m) add((m[1] as string).trim(), nums(m[2] as string));
    }
  }
  return { items, episodes, ages };
}

export function checkHand(hand: string, auto: Auto): string[] {
  const out: string[] = [];
  const lines = hand.split('\n');
  // 作品名は前の行から引き継ぐ（「蘇る逆転 第3話: …」の次の行の「第4話の 5 台詞」のため）
  let game = '';
  lines.forEach((line, i) => {
    if (line.startsWith('#')) game = '';
    const at = `${i + 1} 行`;
    const verify = (label: string, found: string[], what: string) => {
      const key = label.replace(/^〜/, '').replace(/[、。！？]+$/, '');
      // 自動の部分の文末は 3 字までなので、長い語尾（「ですのよ」）は終わりの 3 字（「すのよ」）でも引く
      const known =
        auto.items.get(key) ?? (key.length > 3 ? auto.items.get(key.slice(-3)) : undefined);
      if (!key) return;
      if (!known) {
        if (UNKNOWN)
          out.push(`${at}: 「${key}」（${found.join('・')}）は自動の部分に無い（確かめられない）`);
        return;
      }
      for (const n of found) {
        // 小数を丸めて整数で書いた所（「約 167 倍」など）は合っているとみなす
        const rounded =
          !n.includes('.') &&
          [...known].some((k) => k.includes('.') && Math.round(Number(k)) === Number(n));
        if (!known.has(norm(n)) && !rounded)
          out.push(
            `${at}: 「${key}」の${what} ${n} が自動の部分（${[...known].join('・')}）に無い`,
          );
      }
    };
    // 「語」（…数…）: 括弧の中の数（100 台詞あたり・倍・回）。
    // 「A」「B」（数・数）のように語が並ぶ所、括弧の中に別の「語」がある所、幅や概数（〜・以上・合わせて）は飛ばす。
    for (const m of line.matchAll(/(?<!」)「([^」]+)」\**（([^）「]*\d[^）「]*)）/g)) {
      if (/〜|以上|以下|近い|ほど|合わせて|約/.test(m[2] as string)) continue;
      const inner = (m[2] as string)
        .replace(/100 台詞あたり/g, '')
        .replace(/全体の/g, '')
        .replace(/\d+ ?位/g, '')
        .replace(/1 字/g, '');
      verify(m[1] as string, nums(inner), '数');
    }
    // 「語」も 数 倍 / 「語」 数 倍
    for (const m of line.matchAll(/「([^」]+)」(?:も|は)? ?(?:全体の )?(\d+(?:\.\d+)?) 倍/g))
      verify(m[1] as string, [m[2] as string], '倍');
    // 演出の割合
    for (const k of FX) {
      for (const m of line.matchAll(new RegExp(`${k}(?:が|は|も)? ?(\\d+)%`, 'g'))) {
        const known = auto.items.get(k);
        if (known && !known.has(norm(m[1] as string)))
          out.push(`${at}: ${k} ${m[1]}% が自動の部分（${[...known].join('・')}%）と合わない`);
      }
    }
    // 第N話 … 数 台詞（間に別の人物 ID があれば、その人の数なので見ない）
    const marks: { pos: number; game?: string; ep?: string; n?: number; other?: boolean }[] = [];
    for (const m of line.matchAll(/[a-z][a-z_]+/g)) marks.push({ pos: m.index ?? 0, other: true });
    for (const m of line.matchAll(GAME)) marks.push({ pos: m.index ?? 0, game: m[1] });
    for (const m of line.matchAll(/第(\d)話/g)) marks.push({ pos: m.index ?? 0, ep: m[1] });
    for (const m of line.matchAll(/(\d+) 台詞(?!あたり)/g))
      marks.push({ pos: m.index ?? 0, n: Number(m[1]) });
    marks.sort((a, b) => a.pos - b.pos);
    let ep = '';
    for (const k of marks) {
      if (k.game) game = k.game;
      else if (k.ep) ep = k.ep;
      else if (k.other) ep = '';
      else if (k.n !== undefined && game && ep) {
        const want = auto.episodes.get(`${game} 第${ep}話`);
        if (want !== undefined && want !== k.n)
          out.push(`${at}: ${game} 第${ep}話の台詞 ${k.n} が表（${want}）と合わない`);
      }
    }
    // 年齢の表: | 話 | 立場 | 年齢 | 公式（…） |
    const age = line.match(/^\|.*\| (\d+) \| 公式/);
    if (age && auto.ages.size && !auto.ages.has(norm(age[1] as string)))
      out.push(
        `${at}: 公式の年齢 ${age[1]} が人物ファイルの年齢（${[...auto.ages].join('・')}）に無い`,
      );
  });
  return out;
}

export function checkFile(text: string): string[] {
  const s = text.match(START);
  const b = text.indexOf(END);
  if (!s || b < 0) return ['auto の印が見つからない'];
  const a = (s.index ?? 0) + s[0].length;
  const auto = parseAuto(text.slice(a, b));
  const head = text.slice(0, s.index);
  const tail = text.slice(b);
  const headLines = head.split('\n').length - 1;
  const tailOffset = text.slice(0, b).split('\n').length - 1;
  const shift = (msgs: string[], by: number) =>
    msgs.map((m) => m.replace(/^(\d+) 行/, (_, n) => `${Number(n) + by} 行`));
  return [...shift(checkHand(head, auto), 0), ...shift(checkHand(tail, auto), tailOffset)].filter(
    () => headLines >= 0,
  );
}

if (import.meta.main) {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  let bad = 0;
  for (const f of readdirSync(DIR).sort()) {
    if (!f.endsWith('.md') || f === 'README.md') continue;
    const id = f.replace(/\.md$/, '');
    if (only.length && !only.includes(id)) continue;
    for (const m of checkFile(readFileSync(join(DIR, f), 'utf8'))) {
      console.log(`${id}.md ${m}`);
      if (!m.includes('確かめられない')) bad++;
    }
  }
  console.error(bad ? `食い違い ${bad} 件` : '食い違いなし');
  process.exit(bad ? 1 : 0);
}
