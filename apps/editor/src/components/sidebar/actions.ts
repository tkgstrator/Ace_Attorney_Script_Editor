// 左の一覧からの操作（名前を聞くダイアログを出してから、編集操作を当てる）
import { allNodeIds, isValidId, uniqueId, type PartKind } from '@/model/paths.ts';
import {
  addPartOps, addPlaceOps, addSceneOps, convertToPartsOps, deletePartOps, deletePlaceOps, deleteSceneOps, movePartOps,
  movePlaceOps, moveSceneOps, renamePlaceOps, renameSceneOps, type SceneType,
} from '@/model/structure.ts';
import type { EditorApi } from '@/state/editor-store.tsx';
import { ask, confirmDialog } from '../dialogs.tsx';

const idValidator = (taken: string[], current?: string) => (v: string) =>
  !isValidId(v) ? 'ID は英字・数字・_ で、先頭は英字か _ にしてください'
  : v !== current && taken.includes(v) ? 'この章ですでに使われています' : null;

const run = (api: EditorApi, fn: () => void) => {
  try {
    fn();
  } catch (e) {
    api.notify((e as Error).message, true);
  }
};

export async function addScene(api: EditorApi, part: number | null) {
  const taken = allNodeIds(api.data);
  const r = await ask({
    title: 'シーンを追加',
    choices: [{ value: 'steps', label: '会話・演出（ステップの列）' }, { value: 'testimony', label: '証言（尋問）' }],
    fields: [{ name: 'id', label: 'シーン ID', initial: uniqueId('scene', taken), validate: idValidator(taken) }],
  });
  if (!r) return;
  const id = r.values.id!;
  run(api, () => {
    if (api.edit(addSceneOps(api.data, part, id, (r.choice ?? 'steps') as SceneType))) api.select({ kind: 'scene', part, id });
  });
}

export async function renameScene(api: EditorApi, part: number | null, id: string) {
  const r = await ask({
    title: 'シーンの ID を変更',
    description: 'goto・start.scene・gameover の参照も書き換えます。',
    fields: [{ name: 'id', label: '新しい ID', initial: id, validate: idValidator(allNodeIds(api.data), id) }],
  });
  if (!r || r.values.id === id) return;
  const to = r.values.id!;
  run(api, () => {
    if (api.edit(renameSceneOps(api.data, part, id, to))) api.select({ kind: 'scene', part, id: to });
  });
}

export async function deleteScene(api: EditorApi, part: number | null, id: string) {
  if (await confirmDialog(`シーン「${id}」を削除しますか？`, '元に戻す（Ctrl/Cmd+Z）で取り消せます。')) api.edit(deleteSceneOps(part, id));
}

export const moveScene = (api: EditorApi, part: number | null, id: string, delta: number) =>
  api.edit(moveSceneOps(api.data, part, id, delta));

export async function addPlace(api: EditorApi, part: number) {
  const taken = allNodeIds(api.data);
  const r = await ask({
    title: '場所を追加',
    fields: [
      { name: 'id', label: '場所 ID（背景のキーにもなる）', initial: uniqueId('place', taken), validate: idValidator(taken) },
      { name: 'name', label: '場所の名前', initial: '新しい場所', validate: v => (v ? null : '名前を入れてください') },
    ],
  });
  if (!r) return;
  const id = r.values.id!;
  run(api, () => {
    if (api.edit(addPlaceOps(api.data, part, id, r.values.name!))) api.select({ kind: 'place', part, id });
  });
}

export async function renamePlace(api: EditorApi, part: number, id: string) {
  const r = await ask({
    title: '場所の ID を変更',
    description: 'investigate と「移動する」の行き先の参照も書き換えます。背景のキーを省略している場合は、背景も変わります。',
    fields: [{ name: 'id', label: '新しい ID', initial: id, validate: idValidator(allNodeIds(api.data), id) }],
  });
  if (!r || r.values.id === id) return;
  const to = r.values.id!;
  run(api, () => {
    if (api.edit(renamePlaceOps(api.data, part, id, to))) api.select({ kind: 'place', part, id: to });
  });
}

export async function deletePlace(api: EditorApi, part: number, id: string) {
  if (await confirmDialog(`場所「${id}」を削除しますか？`, '元に戻す（Ctrl/Cmd+Z）で取り消せます。')) api.edit(deletePlaceOps(part, id));
}

export const movePlace = (api: EditorApi, part: number, id: string, delta: number) =>
  api.edit(movePlaceOps(api.data, part, id, delta));

export function addPart(api: EditorApi, kind: PartKind) {
  const { ops, index } = addPartOps(api.data, kind);
  if (api.edit(ops)) api.select({ kind: 'part', part: index });
}

export function convertToParts(api: EditorApi) {
  if (api.edit(convertToPartsOps(api.data))) api.select({ kind: 'part', part: 0 });
}

export async function deletePart(api: EditorApi, index: number, title: string) {
  if (await confirmDialog(`「${title}」を削除しますか？`, '中のシーン・場所もすべて消えます。元に戻す（Ctrl/Cmd+Z）で取り消せます。')) {
    if (api.edit(deletePartOps(index))) api.select({ kind: 'meta' });
  }
}

export function movePart(api: EditorApi, index: number, delta: number) {
  if (api.edit(movePartOps(index, index + delta))) api.select({ kind: 'part', part: index + delta });
}
