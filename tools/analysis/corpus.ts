// 変換済みの公式シナリオ（assets/extracted/**/converted/ep*.yaml）を読み、ステップを文脈つきで並べる。
// 集計スクリプト（tools/analysis/*.ts）の共通部分。YAML の文そのものは出力しない（数と傾向だけを出す）。

import { existsSync } from 'node:fs';
import { join } from 'node:path';

// biome-ignore lint/suspicious/noExplicitAny: 変換済み YAML は形が多様なので、読むときは any で扱う
export type Y = any;

export type Game = 'aa1' | 'aa2' | 'aa3';
export const GAMES: Game[] = ['aa1', 'aa2', 'aa3'];
export const GAME_NAME: Record<Game, string> = {
  aa1: '蘇る逆転',
  aa2: '逆転裁判2',
  aa3: '逆転裁判3',
};

const ROOT = join(import.meta.dir, '../..');
const DIRS: Record<Game, { dir: string; eps: number }> = {
  aa1: { dir: 'assets/extracted/converted', eps: 5 },
  aa2: { dir: 'assets/extracted/aa2/converted', eps: 4 },
  aa3: { dir: 'assets/extracted/aa3/converted', eps: 5 },
};

export interface Episode {
  game: Game;
  ep: number;
  /** 'aa2-3' のような短い名前 */
  key: string;
  title: string;
  data: Y;
  characters: Set<string>;
  /** 編（同じ種類の part が続くまとまり）。part の番号 → 編の名前（探偵1・法廷1…） */
  blockOf: string[];
}

/** 手元にある話をすべて読む（無い話は飛ばす） */
export async function loadEpisodes(): Promise<Episode[]> {
  const out: Episode[] = [];
  for (const game of GAMES) {
    const { dir, eps } = DIRS[game];
    for (let ep = 1; ep <= eps; ep++) {
      const path = join(ROOT, dir, `ep${ep}.yaml`);
      if (!existsSync(path)) {
        console.error(`見つからないので飛ばす: ${path}`);
        continue;
      }
      const data: Y = Bun.YAML.parse(await Bun.file(path).text());
      const blockOf: string[] = [];
      const counter = { investigation: 0, trial: 0 };
      let prev = '';
      for (const p of data.parts ?? []) {
        const kind = p.kind as 'investigation' | 'trial';
        if (kind !== prev) counter[kind]++;
        prev = kind;
        blockOf.push(`${kind === 'trial' ? '法廷' : '探偵'}${counter[kind]}`);
      }
      out.push({
        game,
        ep,
        key: `${game}-${ep}`,
        title: data.title,
        data,
        characters: new Set(Object.keys(data.characters ?? {})),
        blockOf,
      });
    }
  }
  return out;
}

export interface Ctx {
  ep: Episode;
  part: number;
  kind: 'investigation' | 'trial';
  block: string;
  /** シーン ID か、場所なら 'place:ID' */
  scene: string;
  /** シーンの根からの入れ物の鍵（例: ['statements', 'press']、['talk', 'then']） */
  where: string[];
}

export interface StepRec {
  ctx: Ctx;
  step: Y;
  /** ステップの種類（最初の鍵。台詞の省略形は 'line'） */
  type: string;
  /** 同じ配列の中の番号と、配列ごとに振った番号（前後の並びを見るため） */
  index: number;
  arrayId: number;
  /** 同じ配列（ステップの並び） */
  siblings: Y[];
}

let arrayCounter = 0;
const PREFIXED = new Set(['demand', 'nominate', 'pick', 'choice']);

/** ステップの種類。台詞の省略形（人物 ID: 文）は 'line' */
export function stepType(step: Y, chars: Set<string>): string {
  const k = Object.keys(step)[0] ?? '';
  if (chars.has(k) && typeof step[k] === 'string') return 'line';
  return k;
}

function* visitArray(arr: Y[], ctx: Ctx): Generator<StepRec> {
  const arrayId = arrayCounter++;
  for (let i = 0; i < arr.length; i++) {
    const step = arr[i];
    if (!step || typeof step !== 'object' || Array.isArray(step)) continue;
    const type = stepType(step, ctx.ep.characters);
    yield { ctx, step, type, index: i, arrayId, siblings: arr };
    // つきつけの要求などは、中の present・wrong を証言のものと見分けられるよう、種類を前に付ける
    const tag = (k: string) => (PREFIXED.has(type) && k !== type ? `${type}.${k}` : k);
    for (const [k, v] of Object.entries(step))
      yield* visitValue(v, { ...ctx, where: [...ctx.where, tag(k)] });
  }
}

function* visitValue(v: Y, ctx: Ctx): Generator<StepRec> {
  if (Array.isArray(v)) {
    if (v.some((x) => x && typeof x === 'object' && !Array.isArray(x))) yield* visitArray(v, ctx);
    else for (const x of v) if (Array.isArray(x)) yield* visitValue(x, ctx);
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v))
      yield* visitValue(x, { ...ctx, where: [...ctx.where, k] });
  }
}

/** 話のすべてのステップを、書かれた順に出す（分岐の中も含む） */
export function* walkEpisode(ep: Episode): Generator<StepRec> {
  const parts: Y[] = ep.data.parts ?? [];
  for (let pi = 0; pi < parts.length; pi++) {
    const p = parts[pi];
    const base = { ep, part: pi, kind: p.kind, block: ep.blockOf[pi] ?? '?' };
    for (const [id, s] of Object.entries<Y>(p.scenes ?? {})) {
      const ctx: Ctx = { ...base, scene: id, where: [] };
      if (Array.isArray(s)) yield* visitArray(s, ctx);
      else {
        // 証言のシーン。statements の text は reading（証言を聞く所）と同じ文なので、台詞としては数えない
        for (const [k, v] of Object.entries<Y>(s)) {
          if (k === 'statements') {
            for (const st of v)
              for (const [sk, sv] of Object.entries<Y>(st))
                if (sk !== 'text' && sk !== 'id' && sk !== 'when')
                  yield* visitValue(sv, { ...ctx, where: ['statements', sk] });
          } else yield* visitValue(v, { ...ctx, where: [k] });
        }
      }
    }
    for (const [id, pl] of Object.entries<Y>(p.places ?? {})) {
      yield* visitValue(pl, { ...base, scene: `place:${id}`, where: [] });
    }
  }
}

export interface Line {
  rec: StepRec;
  /** 話し手の人物 ID（名前欄なしは null） */
  speaker: string | null;
  /** 文中コマンドを含む元の文 */
  raw: string;
  /** 最初の文字の色（省略は white） */
  color: string;
  auto: boolean;
}

/** ステップが台詞なら Line にする（say・省略形・narrate） */
export function lineOf(rec: StepRec): Line | null {
  const s = rec.step;
  if (rec.type === 'line') {
    const k = Object.keys(s)[0] as string;
    return { rec, speaker: k, raw: s[k], color: 'white', auto: false };
  }
  if (rec.type === 'say' && typeof s.text === 'string')
    return { rec, speaker: s.say ?? null, raw: s.text, color: s.color ?? 'white', auto: !!s.auto };
  if (rec.type === 'narrate' && typeof s.narrate === 'string')
    return { rec, speaker: null, raw: s.narrate, color: s.color ?? 'white', auto: !!s.auto };
  return null;
}

/** 話ごとの台詞を、同じ話し手・同じ文の重複を除いて集める（変換で同じ台詞が分岐ごとに写されているため） */
export function uniqueLines(lines: Line[]): Line[] {
  const seen = new Set<string>();
  const out: Line[] = [];
  for (const l of lines) {
    const k = `${l.rec.ctx.ep.key}\u0000${l.speaker}\u0000${l.raw}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out;
}

/** 別名の人物 ID（大写し・霊媒・子どもの頃など）を本人にまとめる */
export function baseId(id: string): string {
  return id.replace(/_(closeup|channeled_pearl|channeled|child|alt|v\d+)$/, '');
}
