// 編・シーン・場所の追加・名前変更・削除・並べ替えを、編集操作（Op）の列にする。
import {
  allNodeIds, listParts, partPath, placePath, placesPath, scenePath, scenesPath, uniqueId, LEGACY_PART_TITLE,
  type PartKind,
} from './paths.ts';
import type { Op } from './yaml-doc.ts';

type Data = Record<string, unknown> | null;

export const PART_LABELS: Record<PartKind, string> = { investigation: '探索編', trial: '裁判編' };

/** 一番上の scenes（古い形式）を、parts の最初の裁判編に移す */
export function convertToPartsOps(data: Data): Op[] {
  if (!data || data.scenes === undefined) return [];
  const parts = Array.isArray(data.parts) ? data.parts : [];
  const taken = parts.map(p => (p as { id?: string }).id ?? '');
  const ops: Op[] = [];
  if (!Array.isArray(data.parts)) ops.push({ op: 'set', path: ['parts'], value: [] });
  ops.push(
    { op: 'insert', path: ['parts'], index: 0, value: { id: uniqueId('trial', taken), kind: 'trial', title: LEGACY_PART_TITLE } },
    { op: 'relocate', from: ['scenes'], to: ['parts', 0, 'scenes'] },
  );
  return ops;
}

/** 編を末尾に足す。古い形式なら先に parts に変える */
export function addPartOps(data: Data, kind: PartKind, title?: string): { ops: Op[]; index: number } {
  const ops = convertToPartsOps(data);
  const parts = listParts(data).filter(p => p.index !== null);
  const legacy = ops.length > 0;
  const taken = [...parts.map(p => p.id), ...(legacy ? ['trial'] : [])];
  const count = parts.filter(p => p.kind === kind).length + (legacy && kind === 'trial' ? 1 : 0) + 1;
  const base = kind === 'investigation' ? `investigation${count}` : `trial${count}`;
  const value = { id: uniqueId(base, taken), kind, title: title ?? `${PART_LABELS[kind]} ${count}` };
  if (!data || !Array.isArray(data.parts)) {
    if (!legacy) ops.push({ op: 'set', path: ['parts'], value: [] });
  }
  ops.push({ op: 'insert', path: ['parts'], value });
  return { ops, index: parts.length + (legacy ? 1 : 0) };
}

export const deletePartOps = (index: number): Op[] => [{ op: 'delete', path: partPath(index) }];
export const movePartOps = (from: number, to: number): Op[] => [{ op: 'move', path: ['parts'], from, to }];

export type SceneType = 'steps' | 'testimony';

export function sceneTemplate(type: SceneType, witness?: string): unknown {
  if (type === 'steps') return [];
  return {
    testimony: '証言',
    witness: witness ?? 'witness',
    statements: [{ id: 's1', text: '' }],
  };
}

export function addSceneOps(data: Data, part: number | null, id: string, type: SceneType): Op[] {
  if (allNodeIds(data).includes(id)) throw new Error(`ID「${id}」はこの章ですでに使われています`);
  const witness = Object.keys((data?.characters as object | undefined) ?? {})[0];
  return [{ op: 'set', path: scenePath(part, id), value: sceneTemplate(type, witness) }];
}

export function renameSceneOps(data: Data, part: number | null, from: string, to: string): Op[] {
  if (from === to) return [];
  if (allNodeIds(data).includes(to)) throw new Error(`ID「${to}」はこの章ですでに使われています`);
  return [
    { op: 'renameKey', path: scenesPath(part), from, to },
    { op: 'renameRefs', target: 'scene', from, to },
  ];
}

export const deleteSceneOps = (part: number | null, id: string): Op[] => [{ op: 'delete', path: scenePath(part, id) }];

export function moveKeyOps(container: (string | number)[], keys: string[], id: string, delta: number): Op[] {
  const from = keys.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= keys.length) return [];
  return [{ op: 'move', path: container, from, to }];
}

export const moveSceneOps = (data: Data, part: number | null, id: string, delta: number): Op[] =>
  moveKeyOps(scenesPath(part), listParts(data).find(p => p.index === part)?.scenes ?? [], id, delta);

export function addPlaceOps(data: Data, part: number, id: string, name: string): Op[] {
  if (allNodeIds(data).includes(id)) throw new Error(`ID「${id}」はこの章ですでに使われています`);
  return [{ op: 'set', path: placePath(part, id), value: { name } }];
}

export function renamePlaceOps(data: Data, part: number, from: string, to: string): Op[] {
  if (from === to) return [];
  if (allNodeIds(data).includes(to)) throw new Error(`ID「${to}」はこの章ですでに使われています`);
  return [
    { op: 'renameKey', path: placesPath(part), from, to },
    { op: 'renameRefs', target: 'place', from, to },
  ];
}

export const deletePlaceOps = (part: number, id: string): Op[] => [{ op: 'delete', path: placePath(part, id) }];

export const movePlaceOps = (data: Data, part: number, id: string, delta: number): Op[] =>
  moveKeyOps(placesPath(part), listParts(data).find(p => p.index === part)?.places ?? [], id, delta);

/** 新しい章（ファイル）のひな形 */
export function newChapterYaml(id: string, title: string): string {
  return [
    `id: ${id}`,
    `title: ${title}`,
    '',
    'characters:',
    '  naruse: { name: ナルセ, stand: defense }',
    '',
    'evidence:',
    '  badge: { name: 弁護士バッジ, description: 弁護士である証。 }',
    '',
    'start:',
    '  scene: opening',
    '',
    'parts:',
    '  - id: trial1',
    '    kind: trial',
    '    title: 裁判編 1',
    '    scenes:',
    '      opening:',
    '        - naruse: ここから物語が始まる。',
    '        - end: true',
    '',
  ].join('\n');
}
