// 元の台本（mes_all の項目）を、シナリオ YAML（1 つの章）に変換する。
//
// 先に作っておくもの（ROM から。assets/extracted/ の下、配布しない）:
//   uv run tools/rom/script_json.py assets/roms/GYAKUTEN_YOM_AGYJ08_00.nds --ocr   # 台本 → script/json/NNN.json（選択肢の文も）
//   uv run tools/rom/tbl_invest_start.py assets/roms/GYAKUTEN_YOM_AGYJ08_00.nds  # 探偵パートの最初の場所
//   uv run tools/rom/record_text.py                                               # 法廷記録の名前・説明文（文字認識）
// 変換:
//   bun tools/convert/index.ts 0 --id ep1 --title <章の名前> [--out assets/extracted/converted/ep1.yaml] [--stats]
//   bun tools/convert/index.ts 2,4,6,8 --id ep2 --title <章の名前>    # 複数の項目（編）を 1 つの章に
//   （第 1 話 0 / 第 2 話 2,4,6,8 / 第 3 話 10〜16 / 第 4 話 18〜32 / 第 5 話 34〜68 の偶数）
//
// 出力は元のゲームの文を含むので assets/extracted/ の下に置き、配布しない。
// --stats: 命令ごとの変換の内訳と、YAML で表せない所の一覧を出す。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Document, isScalar, visit } from 'yaml';
import { convertChapter } from './chapter.ts';
import { Stats } from './stats.ts';
import { EXTRACTED, loadEntry, loadTables } from './tables.ts';

/** 共通の台本（尋問の見当違いの反応など）の項目: 日本語 072、英語 073 */
const COMMON = { ja: 72, en: 73 } as const;

export const HEADER = [
  ' 元の台本から tools/convert/ で自動生成したもの。手で直さず、変換を直して作り直すこと。',
  ' 元のゲームの文を含むので、手元で遊ぶためだけに使い、配布しないこと（assets/extracted/ は git の対象外）。',
].join('\n');

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

export function toYaml(scenario: Record<string, unknown>): string {
  const doc = new Document(scenario, { aliasDuplicateObjects: true });
  doc.commentBefore = HEADER;
  // 数の並び（native の args など）は 1 行に
  visit(doc, { Seq(_, node) { if (node.items.every(it => isScalar(it) && typeof it.value === 'number')) node.flow = true; } });
  return doc.toString({ lineWidth: 0 });
}

/** investigation.json の parts（無ければ空） */
export function loadInvParts(): Record<string, any>[] {
  const p = join(EXTRACTED, 'tables/investigation.json');
  const parts = existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as { parts: Record<string, any>[] }).parts : [];
  // 着いたときの会話で音楽を止めない版（0x02028850、第 5 話）も、変換では会話 event と同じに扱う
  for (const part of parts) {
    for (const pl of part.places ?? []) {
      for (const path of [...(pl.on_enter ?? []), ...(pl.every_frame ?? [])]) {
        for (const d of path.do ?? []) if (d.event_keep_bgm && !d.event) { d.event = d.event_keep_bgm; delete d.event_keep_bgm; }
      }
    }
  }
  return parts;
}

function main() {
  const args = process.argv.slice(2);
  const stats = args.includes('--stats');
  const rest = args.filter(a => a !== '--stats');
  const id = arg(rest, '--id');
  const title = arg(rest, '--title');
  const outArg = arg(rest, '--out');
  const ns = (rest[0] ?? '').split(',').map(Number);
  if (rest.length !== 1 || ns.some(n => !Number.isInteger(n))) {
    console.error('使い方: bun tools/convert/index.ts <項目の番号（, で複数）> [--id ep1] [--title 章の名前] [--out ファイル] [--stats]');
    process.exit(2);
  }
  const tables = loadTables();
  const entries = ns.map(n => loadEntry(n));
  let common = null;
  try { common = loadEntry(COMMON[entries[0]!.lang]); } catch { console.warn('共通の台本（072/073）が無いので、尋問の外れなどは native にします'); }
  // 3D で詳しく調べるときの台詞（第 5 話）: 日本語 070、英語 071
  let item070 = null;
  if (ns.some(n => n >= 34)) try { item070 = loadEntry(entries[0]!.lang === 'ja' ? 70 : 71); } catch { console.warn('項目 070 が無いので、3D で調べる台詞は native にします'); }
  const cid = id ?? `e${ns.map(n => String(n).padStart(3, '0')).join('_')}`;
  const { scenario, results } = convertChapter(tables, entries, { id: cid, title: title ?? `項目 ${ns.join(', ')}`, common, invParts: loadInvParts(), item070 });
  const out = outArg ?? join(EXTRACTED, 'converted', `${cid}.yaml`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, toYaml(scenario));
  const all = new Stats();
  for (const r of results) all.merge(r.ctx.stats);
  const t = all.totals();
  const count = (k: string) => (scenario.parts as Record<string, Record<string, object>>[]).reduce((a, p) => a + Object.keys(p[k] ?? {}).length, 0);
  console.log(`${out}: シーン ${count('scenes')}、場所 ${count('places')}、人物 ${Object.keys(scenario.characters as object).length}、`
    + `証拠品 ${Object.keys(scenario.evidence as object).length}（命令: ステップ ${t.step}、文中 ${t.inline}、構造 ${t.structure}、`
    + `近似 ${t.approx}、native ${t.native}、無視 ${t.ignored}）`);
  if (stats) console.log(`\n${all.report()}`);
}

if (import.meta.main) main();
