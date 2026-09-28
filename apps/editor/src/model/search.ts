// 章の中の検索（シーン・場所の ID、台詞・ナレーションなどの文、話し手）。
// 画面に描いたものではなく章のデータを調べる。索引はデータ（編集のたびに変わる）ごとに 1 回だけ作る
import { listParts, type Selection } from './paths.ts';
import { stepKind } from './steps.ts';
import type { Path } from './yaml-doc.ts';

export interface SearchEntry {
  selection: Selection;
  /** 開いた項目の中の場所 */
  path: Path;
  /** 何が当たったか（ID・台詞・話し手など） */
  kind: 'id' | 'text' | 'speaker';
  /** 話し手（台詞のとき） */
  speaker?: string;
  text: string;
  /** 小文字にしたもの（比べる用） */
  lower: string;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 文として検索するキー（ID などの記号は入れない） */
const TEXT_KEYS = new Set([
  'text',
  'narrate',
  'banner',
  'card',
  'demand',
  'pick',
  'testimony',
  'topic',
  'name',
  'spot',
]);

const cache = new WeakMap<object, SearchEntry[]>();

export function buildIndex(data: Rec | null): SearchEntry[] {
  if (!data) return [];
  const hit = cache.get(data);
  if (hit) return hit;
  const out: SearchEntry[] = [];
  const add = (e: Omit<SearchEntry, 'lower'>) => out.push({ ...e, lower: e.text.toLowerCase() });

  const walk = (v: unknown, path: Path, sel: Selection) => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        walk(x, [...path, i], sel);
      });
      return;
    }
    if (!isRec(v)) return;
    const kind = stepKind(v);
    if (kind === 'shorthand') {
      const [speaker, text] = Object.entries(v)[0]!;
      add({ selection: sel, path: [...path, speaker], kind: 'text', speaker, text: String(text) });
      return;
    }
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === 'string' && TEXT_KEYS.has(k)) {
        add({
          selection: sel,
          path: [...path, k],
          kind: 'text',
          ...(kind === 'say' && typeof v.say === 'string' ? { speaker: v.say } : {}),
          text: x,
        });
      } else if (typeof x === 'object' && x !== null) walk(x, [...path, k], sel);
    }
  };

  for (const p of listParts(data)) {
    const base: Path = p.index === null ? ['scenes'] : ['parts', p.index];
    const part: unknown =
      p.index !== null && Array.isArray(data.parts) ? data.parts[p.index] : undefined;
    const scenes = p.index === null ? data.scenes : isRec(part) ? part.scenes : undefined;
    for (const id of p.scenes) {
      const sel: Selection = { kind: 'scene', part: p.index, id };
      const path = p.index === null ? [...base, id] : [...base, 'scenes', id];
      add({ selection: sel, path, kind: 'id', text: id });
      walk(isRec(scenes) ? scenes[id] : undefined, path, sel);
    }
    const places = isRec(part) && isRec(part.places) ? part.places : {};
    for (const id of p.places) {
      if (p.index === null) continue;
      const sel: Selection = { kind: 'place', part: p.index, id };
      const path = [...base, 'places', id];
      add({ selection: sel, path, kind: 'id', text: id });
      walk(places[id], path, sel);
    }
  }
  cache.set(data, out);
  return out;
}

export interface SearchResult extends SearchEntry {
  /** 当たった位置（text の中） */
  at: number;
}

/**
 * query を含むもの。「人物ID:」で始めると、その人物の台詞だけを探す（例: naruse: 証拠）
 * 多すぎるときは limit 件まで
 */
export function search(index: SearchEntry[], query: string, limit = 200): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(q);
  const speaker = m?.[1];
  const words = m ? m[2]! : q;
  const out: SearchResult[] = [];
  for (const e of index) {
    if (speaker !== undefined && e.speaker?.toLowerCase() !== speaker) continue;
    const at = words ? e.lower.indexOf(words) : 0;
    if (at < 0) continue;
    out.push({ ...e, at });
    if (out.length >= limit) break;
  }
  return out;
}

/** 当たった所の前後を切り出す */
export function snippet(r: SearchResult, len: number, around = 12): string {
  const start = Math.max(0, r.at - around);
  const s = r.text.slice(start, r.at + len + 40).replace(/\s+/g, ' ');
  return (start > 0 ? '…' : '') + s;
}
