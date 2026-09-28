// 変換した章で、出している立ち絵（動きの番号の絵）が人物と合っているかを確かめる。
//
//   bun tools/convert/portraits.ts --game aa3 [章の YAML ...] [--list] [--html 出力.html] [--tables 表の置き場所]
//   （YAML を省くと assets/extracted/<ゲーム>/converted/ep*.yaml を全部。蘇る逆転は --game aa1）
//
// 見るもの（名札 = 人物の name。「？？？」と名札の無い人物は除く）:
//   1. 絵のファイルの持ち主: 動きの番号 → 絵のファイル（tables/char_anims.json の file）。1 つのファイルの絵を
//      別の名札の人物に出していれば食い違い（動きの番号の表がずれていると、隣の人物の絵が出てこうなる）
//   2. 動きの人物: 動きの番号を台本で使う人物（char_anims.json の char）の名札と、出している人物の名札が違えば食い違い
//   3. 話し手と立ち絵（--list）: 台詞の話し手の名札 × そのとき出ている人物の名札の数の一覧（主人公の台詞は除く）
// --html: 名札ごとに出している絵（各動きの最初のコマ）を並べたページを書く（目で確かめる用）
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { GAMES, type GameKey } from './tables.ts';

export interface AnimRow {
  file: string;
  char: number | null;
}
export interface PortraitUse {
  /** 章の中の人物 ID */
  id: string;
  anim: number;
  /** そのとき話している人物 ID（台詞の前の show なら null） */
  speaker: string | null;
}

const SHOW_INLINE = /\[show (\S+)(?: (\d+))?(?: (\d+))?\]/g;

/** 章（YAML を読んだもの）から、出した立ち絵と、その間の台詞の話し手を集める */
export function collectUses(chapter: Record<string, any>): PortraitUse[] {
  const chars = new Set(Object.keys(chapter.characters ?? {}));
  const out: PortraitUse[] = [];
  let shown: { id: string; anim: number } | null = null;
  const text = (who: string | null, s: string) => {
    for (const m of s.matchAll(SHOW_INLINE)) {
      if (m[1] === 'null') shown = null;
      else if (m[2]) {
        shown = { id: m[1]!, anim: Number(m[2]) };
        out.push({ ...shown, speaker: null });
        if (m[3] && m[3] !== m[2]) out.push({ id: m[1]!, anim: Number(m[3]), speaker: null });
      }
    }
    if (who && shown) out.push({ ...shown, speaker: who });
  };
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) {
      for (const v of x) walk(v);
      return;
    }
    if (typeof x !== 'object' || x === null) return;
    const o = x as Record<string, unknown>;
    if ('show' in o) {
      if (o.show === null) shown = null;
      else if (typeof o.show === 'string' && typeof o.talk === 'number') {
        shown = { id: o.show, anim: o.talk };
        out.push({ ...shown, speaker: null });
        if (typeof o.idle === 'number') out.push({ id: o.show, anim: o.idle, speaker: null });
      }
    }
    const keys = Object.keys(o);
    if (keys.length === 1 && chars.has(keys[0]!) && typeof o[keys[0]!] === 'string') {
      text(keys[0]!, o[keys[0]!] as string);
      return;
    }
    if (typeof o.say === 'string' && typeof o.text === 'string') {
      text(o.say, o.text);
      return;
    }
    for (const v of Object.values(o)) walk(v);
  };
  walk(chapter.scenes ?? chapter);
  return out;
}

export interface Mismatch {
  kind: 'file' | 'anim';
  anim: number;
  file: string;
  tags: string[];
  count: number;
}

/**
 * 立ち絵の食い違いを探す。tagOf = 人物 ID → 名札（除く人物は null）、charTag = 台本の人物の番号 → 名札
 */
export function findMismatches(
  uses: PortraitUse[],
  anims: Record<string, AnimRow>,
  tagOf: (id: string) => string | null,
  charTag: (c: number) => string | null,
): Mismatch[] {
  const byFile = new Map<string, Map<string, number>>();
  const out: Mismatch[] = [];
  const animSeen = new Map<string, number>();
  for (const u of uses) {
    if (u.speaker !== null) continue;
    const tag = tagOf(u.id);
    const row = anims[String(u.anim)];
    if (!tag || !row) continue;
    const m = byFile.get(row.file) ?? new Map<string, number>();
    m.set(tag, (m.get(tag) ?? 0) + 1);
    byFile.set(row.file, m);
    const owner = row.char === null ? null : charTag(row.char);
    if (owner && owner !== tag) {
      const k = `${u.anim}\t${tag}\t${owner}`;
      animSeen.set(k, (animSeen.get(k) ?? 0) + 1);
    }
  }
  for (const [file, m] of byFile) {
    if (m.size < 2) continue;
    const tags = [...m.keys()];
    out.push({
      kind: 'file',
      anim: -1,
      file,
      tags,
      count: [...m.values()].reduce((a, b) => a + b),
    });
  }
  for (const [k, count] of animSeen) {
    const [anim, tag, owner] = k.split('\t') as [string, string, string];
    out.push({
      kind: 'anim',
      anim: Number(anim),
      file: anims[anim]!.file,
      tags: [tag, owner],
      count,
    });
  }
  return out;
}

/** 話し手の名札 × 出ている人物の名札 → 台詞の数（主人公の台詞は除く） */
export function speakerTable(
  uses: PortraitUse[],
  tagOf: (id: string) => string | null,
  player: string,
): Map<string, number> {
  const t = new Map<string, number>();
  for (const u of uses) {
    if (u.speaker === null || u.speaker === player) continue;
    const k = `${tagOf(u.speaker) ?? u.speaker}\t${tagOf(u.id) ?? u.id}`;
    t.set(k, (t.get(k) ?? 0) + 1);
  }
  return t;
}

function readJson<T>(p: string): T {
  return JSON.parse(readFileSync(p, 'utf8')) as T;
}

function main() {
  const args = process.argv.slice(2);
  const opt = (name: string) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    return args.splice(i, 2)[1];
  };
  const game = (opt('--game') ?? 'aa1') as GameKey;
  const html = opt('--html');
  const list = args.includes('--list');
  const dir = GAMES[game].dir;
  const tables = opt('--tables') ?? join(dir, 'tables');
  let files = args.filter((a) => !a.startsWith('--'));
  if (!files.length) {
    const conv = join(dir, 'converted');
    files = existsSync(conv)
      ? readdirSync(conv)
          .filter((f) => /^ep\d+\.yaml$/.test(f))
          .map((f) => join(conv, f))
      : [];
  }
  const anims = readJson<{ anims: Record<string, AnimRow> }>(join(tables, 'char_anims.json')).anims;
  const names = readJson<{ names: { id: number; text: { ja: string } }[] }>(
    join(tables, 'names.json'),
  ).names;
  const chars = readJson<{ chars: Record<string, { name_id: number }> }>(
    join(tables, 'chars.json'),
  ).chars;
  const usable = (s: string | undefined) => (s && !s.startsWith('？') ? s : null);
  const charTag = (c: number) =>
    usable(names.find((n) => n.id === (chars[String(c)]?.name_id ?? c))?.text.ja);
  let bad = 0;
  const gallery = new Map<string, Set<number>>();
  for (const f of files) {
    const ch = parse(readFileSync(f, 'utf8')) as Record<string, any>;
    const cs = (ch.characters ?? {}) as Record<string, { name?: string }>;
    const tagOf = (id: string) => usable(cs[id]?.name);
    const uses = collectUses(ch);
    const ms = findMismatches(uses, anims, tagOf, charTag);
    bad += ms.length;
    console.log(`${f}: 立ち絵 ${uses.filter((u) => !u.speaker).length} 回、食い違い ${ms.length}`);
    for (const m of ms) {
      if (m.kind === 'file')
        console.log(
          `  絵のファイル ${m.file} を別の人物に出している: ${m.tags.join('・')}（${m.count} 回）`,
        );
      else
        console.log(
          `  動き ${m.anim}（ファイル ${m.file}）を ${m.tags[0]} に出しているが、台本では ${m.tags[1]} の動き（${m.count} 回）`,
        );
    }
    if (list) {
      const t = [...speakerTable(uses, tagOf, String(ch.player ?? '')).entries()].sort(
        (a, b) => b[1] - a[1],
      );
      for (const [k, n] of t) {
        const [s, shown] = k.split('\t');
        console.log(`  ${s === shown ? ' ' : '≠'} 話し手 ${s} ／ 立ち絵 ${shown}: ${n}`);
      }
    }
    for (const u of uses) {
      const tag = tagOf(u.id) ?? u.id;
      if (!gallery.has(tag)) gallery.set(tag, new Set());
      gallery.get(tag)!.add(u.anim);
    }
  }
  if (html) {
    const rows = [...gallery.entries()]
      .sort(([a], [b]) => a.localeCompare(b, 'ja'))
      .map(([tag, set]) => {
        const imgs = [...set]
          .sort((a, b) => a - b)
          .map((a) => {
            const png = join(dir, `data/tail/chars/by_anim/${String(a).padStart(3, '0')}/f00.png`);
            return `<figure><img src="file://${png}" loading="lazy"><figcaption>${a}</figcaption></figure>`;
          });
        return `<h2>${tag}</h2><div class="row">${imgs.join('')}</div>`;
      });
    writeFileSync(
      html,
      `<!doctype html><meta charset="utf-8"><title>立ち絵の一覧 ${game}</title><style>body{font-family:sans-serif;background:#ccc}.row{display:flex;flex-wrap:wrap;gap:4px}figure{margin:0;text-align:center}img{height:96px}</style>${rows.join('\n')}`,
    );
    console.log(`→ ${html}`);
  }
  if (bad) process.exitCode = 1;
}

if (import.meta.main) main();
