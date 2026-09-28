// 章（YAML 1 ファイル）の中の場所を指すための型と、パスの計算。
// 編（parts）に分けていない古い形式では、一番上の scenes を 1 つの裁判編として扱う（part = null）。
import type { Path } from './yaml-doc.ts';

export type PartKind = 'investigation' | 'trial';

export type Selection =
  | { kind: 'meta' }
  | { kind: 'characters' }
  | { kind: 'evidence' }
  | { kind: 'flags' }
  | { kind: 'yaml' }
  | { kind: 'part'; part: number }
  | { kind: 'scene'; part: number | null; id: string }
  | { kind: 'place'; part: number; id: string };

export interface PartInfo {
  /** parts の番号。一番上の scenes なら null */
  index: number | null;
  id: string;
  kind: PartKind;
  title: string;
  scenes: string[];
  places: string[];
}

type Data = Record<string, unknown> | null | undefined;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const LEGACY_PART_TITLE = '裁判編';

export function listParts(data: Data): PartInfo[] {
  if (!data) return [];
  const result: PartInfo[] = [];
  if (isRecord(data.scenes)) {
    result.push({
      index: null,
      id: '',
      kind: 'trial',
      title: LEGACY_PART_TITLE,
      scenes: Object.keys(data.scenes),
      places: [],
    });
  }
  if (Array.isArray(data.parts)) {
    data.parts.forEach((p, i) => {
      const part = isRecord(p) ? p : {};
      result.push({
        index: i,
        id: typeof part.id === 'string' ? part.id : '',
        kind: part.kind === 'investigation' ? 'investigation' : 'trial',
        title: typeof part.title === 'string' ? part.title : '',
        scenes: isRecord(part.scenes) ? Object.keys(part.scenes) : [],
        places: isRecord(part.places) ? Object.keys(part.places) : [],
      });
    });
  }
  return result;
}

export const partPath = (part: number): Path => ['parts', part];
export const scenesPath = (part: number | null): Path =>
  part === null ? ['scenes'] : ['parts', part, 'scenes'];
export const placesPath = (part: number): Path => ['parts', part, 'places'];
export const scenePath = (part: number | null, id: string): Path => [...scenesPath(part), id];
export const placePath = (part: number, id: string): Path => [...placesPath(part), id];

/** 章の中のすべてのシーン ID（goto などの選択肢に使う） */
export const allSceneIds = (data: Data) => listParts(data).flatMap((p) => p.scenes);
/** 章の中のすべての場所 ID */
export const allPlaceIds = (data: Data) => listParts(data).flatMap((p) => p.places);
/** 章の中のシーン・場所の ID（重なってはいけないもの） */
export const allNodeIds = (data: Data) => [...allSceneIds(data), ...allPlaceIds(data)];

export const recordKeys = (v: unknown): string[] => (isRecord(v) ? Object.keys(v) : []);

/** base, base_2, base_3 … のうち、まだ使われていないもの */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const set = new Set(taken);
  if (!set.has(base)) return base;
  for (let n = 2; ; n++) if (!set.has(`${base}_${n}`)) return `${base}_${n}`;
}

export const ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const isValidId = (s: string) => ID_PATTERN.test(s);

/**
 * 診断などのパスから、エディタで開く項目を決める。
 * 見つからなければ null。focus は開いた項目の中でのパス（ステップの位置など）
 */
export function selectionFromPath(path: Path): { selection: Selection; focus: Path } | null {
  const [head, a, b, c] = path;
  switch (head) {
    case 'characters':
      return { selection: { kind: 'characters' }, focus: path };
    case 'evidence':
      return { selection: { kind: 'evidence' }, focus: path };
    case 'flags':
      return { selection: { kind: 'flags' }, focus: path };
    case 'id':
    case 'title':
    case 'player':
    case 'life':
    case 'defaults':
    case 'start':
    case 'gameover':
      return { selection: { kind: 'meta' }, focus: path };
    case 'scenes':
      if (typeof a === 'string')
        return { selection: { kind: 'scene', part: null, id: a }, focus: path };
      return null;
    case 'parts': {
      if (typeof a !== 'number') return null;
      if (b === 'scenes' && typeof c === 'string')
        return { selection: { kind: 'scene', part: a, id: c }, focus: path };
      if (b === 'places' && typeof c === 'string')
        return { selection: { kind: 'place', part: a, id: c }, focus: path };
      return { selection: { kind: 'part', part: a }, focus: path };
    }
    default:
      return null;
  }
}

/** 選択している項目の YAML 上のパス（開いている項目の中のパスの判定に使う） */
export function selectionPath(sel: Selection): Path | null {
  switch (sel.kind) {
    case 'scene':
      return scenePath(sel.part, sel.id);
    case 'place':
      return placePath(sel.part, sel.id);
    case 'part':
      return partPath(sel.part);
    case 'characters':
    case 'evidence':
    case 'flags':
      return [sel.kind];
    default:
      return null;
  }
}

/** 選択が今のデータでも有効か（削除・名前変更の後の確認） */
export function selectionExists(data: Data, sel: Selection): boolean {
  const parts = listParts(data);
  switch (sel.kind) {
    case 'scene':
      return parts.some((p) => p.index === sel.part && p.scenes.includes(sel.id));
    case 'place':
      return parts.some((p) => p.index === sel.part && p.places.includes(sel.id));
    case 'part':
      return parts.some((p) => p.index === sel.part);
    default:
      return true;
  }
}

export const pathKey = (path: Path) => JSON.stringify(path);

/** a が b で始まるか */
export const startsWith = (a: Path, b: Path) =>
  b.length <= a.length && b.every((k, i) => a[i] === k);

/** シーンか場所の ID から、それを開く選択を作る（見つからなければ null） */
export function selectionForNode(data: Data, id: string): Selection | null {
  return selectionForNodeIn(listParts(data), id);
}

/** selectionForNode の、編の一覧（listParts の結果）から探す版 */
export function selectionForNodeIn(parts: PartInfo[], id: string): Selection | null {
  for (const p of parts) {
    if (p.scenes.includes(id)) return { kind: 'scene', part: p.index, id };
    if (p.index !== null && p.places.includes(id)) return { kind: 'place', part: p.index, id };
  }
  return null;
}

/** 選択の短い名前（通知などに出す） */
export function selectionLabel(sel: Selection): string {
  switch (sel.kind) {
    case 'meta':
      return '基本情報';
    case 'characters':
      return '人物';
    case 'evidence':
      return '証拠品';
    case 'flags':
      return 'フラグ';
    case 'yaml':
      return 'YAML';
    case 'part':
      return `編 ${sel.part + 1}`;
    case 'scene':
      return `シーン ${sel.id}`;
    case 'place':
      return `場所 ${sel.id}`;
  }
}

/** 同じ項目を指しているか */
export const sameSelection = (a: Selection, b: Selection) =>
  JSON.stringify(a) === JSON.stringify(b);
