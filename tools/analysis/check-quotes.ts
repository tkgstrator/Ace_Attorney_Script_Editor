// docs に、公式の台詞・説明文と同じ文字列が載っていないかを確かめる。
// 使い方: bun tools/analysis/check-quotes.ts [--len 10] [ファイルかフォルダ ...]（既定は docs/characters。フォルダは下のフォルダも見る）
// 公式の文: 変換済み YAML（assets/extracted/**/converted/ep*.yaml）の文字列すべてと、
// 法廷記録・選択肢の表（assets/extracted/**/tables/{record_text,choice_text}.json）の文字列。
// 空白・改行・文中コマンド（[wait 8] など）・Markdown の記号を除いてから、--len 字（既定 10）以上続けて一致する所を出す。
// 自動の部分（auto の印の間。語尾などの断片と数だけ）と、話の題は比べない。
// 決まり文句の許可リスト（tools/analysis/stock-phrases.json。「弁護側、準備完了しています。」のような手続きの定型句）に
// 当たる所も比べない。許可リストの句の基準（複数の話・複数の話し手に出るか）は phrases.ts が確かめる。
// 一致があれば終了コード 1。出力には一致した文字列が入るので、結果は手元で見るだけにする（公開しない）。

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadStockPhrases, stockRegex } from './stock.ts';

const ROOT = join(import.meta.dir, '../..');
const args = process.argv.slice(2);
const li = args.indexOf('--len');
const LEN = li >= 0 ? Number(args[li + 1]) : 10;
const targets = args.filter((a, i) => !a.startsWith('--') && (li < 0 || i !== li + 1));
if (!targets.length) targets.push(join(ROOT, 'docs/characters'));

/** 比べる前にそろえる: 文中コマンド・空白・改行・Markdown や引用の記号を除く */
export function normalize(s: string): string {
  return s
    .replace(/\[\[/g, '[')
    .replace(/\[[a-zA-Z][^\]]*\]/g, '')
    .replace(/\\n/g, '')
    .replace(/[\s　]/g, '')
    .replace(/[*`|#>「」『』（）()]/g, '');
}

function strings(x: unknown, out: string[]): void {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) for (const y of x) strings(y, out);
  else if (x && typeof x === 'object') for (const v of Object.values(x)) strings(v, out);
}

/** 話の題（docs に載せてよいもの） */
const titles: string[] = [];

async function officialTexts(): Promise<string[]> {
  const out: string[] = [];
  const dirs = ['assets/extracted', 'assets/extracted/aa2', 'assets/extracted/aa3'];
  for (const d of dirs) {
    const conv = join(ROOT, d, 'converted');
    if (existsSync(conv))
      for (const f of readdirSync(conv).filter((f) => /^ep\d+\.yaml$/.test(f))) {
        const data = Bun.YAML.parse(await Bun.file(join(conv, f)).text()) as { title?: string };
        if (data.title) titles.push(data.title);
        strings(data, out);
      }
    for (const t of ['record_text.json', 'choice_text.json']) {
      const p = join(ROOT, d, 'tables', t);
      if (existsSync(p)) strings(JSON.parse(readFileSync(p, 'utf8')), out);
    }
  }
  return out;
}

/** 公式の文の、LEN 字のすべての切り出し */
function windows(texts: string[]): Set<string> {
  const set = new Set<string>();
  for (const t of texts) {
    const n = normalize(t);
    // かな・漢字を含まない文字列（ID やファイル名）は比べない
    if (n.length < LEN || !/[぀-ヿ一-鿿]/.test(n)) continue;
    for (let i = 0; i + LEN <= n.length; i++) set.add(n.slice(i, i + LEN));
  }
  return set;
}

/** フォルダなら、中の .md をすべて（下のフォルダも） */
function files(p: string): string[] {
  if (statSync(p).isDirectory())
    return readdirSync(p)
      .sort()
      .flatMap((f) =>
        f.endsWith('.md') || statSync(join(p, f)).isDirectory() ? files(join(p, f)) : [],
      );
  return [p];
}

/** 決まり文句（許可リスト）。docs で使っても一致に数えない */
const stock = loadStockPhrases().map((s) => stockRegex(s.phrase));

/** 1 行の中で、公式の文と LEN 字以上続けて一致する所（重なる窓はつなげて 1 つにする） */
export function matches(line: string, set: Set<string>): string[] {
  let text = line;
  for (const t of titles) text = text.split(t).join('／');
  let n = normalize(text);
  for (const re of stock) n = n.replace(re, '／');
  const out: string[] = [];
  let start = -1;
  let end = -1;
  for (let i = 0; i + LEN <= n.length; i++) {
    if (!set.has(n.slice(i, i + LEN))) continue;
    if (start >= 0 && i <= end) end = i + LEN;
    else {
      if (start >= 0) out.push(n.slice(start, end));
      start = i;
      end = i + LEN;
    }
  }
  if (start >= 0) out.push(n.slice(start, end));
  return out;
}

if (import.meta.main) {
  const set = windows(await officialTexts());
  if (!set.size) {
    console.error('公式の文が見つからない（assets/extracted が無い）');
    process.exit(2);
  }
  let hits = 0;
  for (const t of targets)
    for (const f of files(t)) {
      let auto = false;
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (line.startsWith('<!-- auto:start')) auto = true;
          if (line.startsWith('<!-- auto:end')) auto = false;
          if (auto) return;
          for (const m of matches(line, set)) {
            console.log(`${f.replace(`${ROOT}/`, '')}:${i + 1}: ${m}`);
            hits++;
          }
        });
    }
  console.error(hits ? `一致 ${hits} 件（${LEN} 字以上）` : `一致なし（${LEN} 字以上）`);
  process.exit(hits ? 1 : 0);
}
