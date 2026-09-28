// 章のデータから、選択肢に使う名前の一覧・左の一覧に出すものを作る（中身が同じなら前のものを使う）
import type { Data } from '@/model/doc-session.ts';
import { type PartInfo, recordKeys } from '@/model/paths.ts';
import { isTestimony } from '@/model/steps.ts';
import type { Ids, TreePart } from './store.ts';

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** 中身が同じなら前の配列を使う（選択肢の一覧を持つ部品を描き直さないため） */
export function deriveIds(data: Data | null, prev: Ids, parts: PartInfo[]): Ids {
  const next: Ids = {
    characters: recordKeys(data?.characters),
    evidence: recordKeys(data?.evidence),
    scenes: parts.flatMap((p) => p.scenes),
    places: parts.flatMap((p) => p.places),
    flags: recordKeys(data?.flags),
  };
  let changed = false;
  for (const k of Object.keys(next) as (keyof Ids)[]) {
    if (sameList(next[k], prev[k])) next[k] = prev[k];
    else changed = true;
  }
  return changed ? next : prev;
}

export function deriveTree(data: Data | null, prev: TreePart[], parts: PartInfo[]): TreePart[] {
  const rec = (v: unknown) =>
    typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};
  const next = parts.map((p) => {
    const base = rec(p.index === null ? data?.scenes : rec(rec(data?.parts)[p.index]).scenes);
    const places = p.index === null ? {} : rec(rec(rec(data?.parts)[p.index]).places);
    return {
      ...p,
      testimony: p.scenes.map((id) => isTestimony(base[id])),
      placeNames: p.places.map((id) => String(rec(places[id]).name ?? '')),
    };
  });
  return JSON.stringify(next) === JSON.stringify(prev) ? prev : next;
}
