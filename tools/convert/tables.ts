// assets/extracted の表を読み、人物・証拠品・音の ID を決める。
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadIdTables } from './character-ids.ts';
import type { Entry, Tables } from './types.ts';

export const ROOT = resolve(import.meta.dir, '../..');
export const EXTRACTED = join(ROOT, 'assets/extracted');

/** どのゲームの台本か（aa1 = 蘇る逆転、aa2 = 逆転裁判2、aa3 = 逆転裁判3） */
export type GameKey = 'aa1' | 'aa2' | 'aa3';
export const GAMES: Record<GameKey, { dir: string; commonItem: number }> = {
  aa1: { dir: EXTRACTED, commonItem: 72 },
  aa2: { dir: join(EXTRACTED, 'aa2'), commonItem: 44 },
  aa3: { dir: join(EXTRACTED, 'aa3'), commonItem: 84 },
};

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

/** tools/rom/script_json.py が書き出した項目の JSON */
export function loadEntry(n: number, dir = join(EXTRACTED, 'script/json')): Entry {
  const path = join(dir, `${String(n).padStart(3, '0')}.json`);
  if (!existsSync(path)) {
    throw new Error(
      `${path} がありません。先に uv run tools/rom/script_json.py <rom.nds> ${n} --ocr を実行してください`,
    );
  }
  return readJson<Entry>(path);
}

export function loadTables(dir = join(EXTRACTED, 'tables'), game: GameKey = 'aa1'): Tables {
  const names = readJson<{ names: Tables['names'] }>(join(dir, 'names.json')).names;
  const chars = readJson<{ chars: Tables['chars'] }>(join(dir, 'chars.json')).chars;
  const ev = readJson<{ items: Tables['evidence']; start: Tables['evidenceStart'] }>(
    join(dir, 'evidence.json'),
  );
  const court = readJson<Tables['court']>(join(dir, 'court.json'));
  const sounds = new Map<number, string>();
  const rendered = join(dir, '../sound/rendered/index.json');
  if (existsSync(rendered)) {
    for (const it of readJson<{ items: { sdatIndex: number; name: string }[] }>(rendered).items)
      sounds.set(it.sdatIndex, it.name);
  } else {
    const s = readJson<{
      bgm: Record<string, { name: string }>;
      se?: Record<string, { name: string }>;
    }>(join(dir, 'sound.json'));
    for (const [k, v] of Object.entries({ ...s.bgm, ...s.se })) sounds.set(Number(k), v.name);
  }
  const rtPath = join(dir, 'record_text.json');
  const recordText = existsSync(rtPath)
    ? readJson<{ items: Record<string, { name: string; desc: string }> }>(rtPath).items
    : undefined;
  const profPath = join(dir, 'profiles.json');
  const profiles =
    game !== 'aa1' && existsSync(profPath)
      ? readJson<{ items: NonNullable<Tables['profiles']> }>(profPath).items
      : undefined;
  const startPath = join(dir, 'invest_start.json');
  const investStart = existsSync(startPath)
    ? readJson<{ start: Record<string, number> }>(startPath).start
    : undefined;
  const invPath = join(dir, 'investigation.json');
  const courtPoints = existsSync(invPath)
    ? readJson<{ court_point?: Tables['courtPoints'] }>(invPath).court_point
    : undefined;
  const soundJson = join(dir, 'sound.json');
  const blipKinds = existsSync(soundJson)
    ? (readJson<{ blip?: { name_kind?: number[] } }>(soundJson).blip?.name_kind ?? [])
    : [];
  const x3dPath = join(dir, 'examine3d.json');
  const examine3d = existsSync(x3dPath) ? readJson<Tables['examine3d']>(x3dPath) : undefined;
  const mgPath = join(dir, 'minigames.json');
  const minigames = existsSync(mgPath) ? readJson<Tables['minigames']>(mgPath) : undefined;
  return {
    game,
    names,
    chars,
    evidence: ev.items,
    evidenceStart: ev.start,
    court,
    sounds,
    investStart,
    blipKinds,
    courtPoints,
    recordText,
    profiles,
    ids: loadIdTables()[game],
    examine3d,
    minigames,
  };
}

/** 英語の名札から人物の ID を作る（例: Phoenix → phoenix、Desirée → desiree）。使えなければ空 */
export function slug(en: string): string {
  const s = en
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return /^[a-z]/.test(s) ? s : '';
}

/** 音の番号 → ID（SDAT の名前。無ければ snd番号） */
export const soundId = (t: Tables, n: number) => t.sounds.get(n) ?? `snd${n}`;

/**
 * 法廷記録の名前「綾里 千尋（27）」→ 氏名と年齢。文字認識の読み違い（「（」を「1」と読む、年齢が名前の間に入る
 * 「綾里117）真宵」）も直す
 */
export function parseProfileName(s: string): { name: string; age?: number } {
  const m = s.match(/^(.*?)\s*[（(1](\d{1,2})[）)]\s*(.*)$/);
  if (!m) return { name: s.trim() };
  const name = `${m[1]!.trim()}${m[3] ? ` ${m[3].trim()}` : ''}`.trim();
  return { name, age: Number(m[2]) };
}

/**
 * 表（探偵パート・法廷）の区画の参照 { raw, script, section } が、この項目の台本の区画か。
 * script が common のものは共通の台本（072/073）の区画で、section の番号は項目の台本とは別物
 */
export const isStorySection = (o: Record<string, unknown>): boolean =>
  o.script === 'story' || (o.raw !== undefined && o.script !== 'common');
