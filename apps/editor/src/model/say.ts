// 台詞（省略形 `人物ID: 台詞` と完全形 `say:`）の読み書き。
// 編集では、変えた属性だけを書き換える（auto など、ほかの属性を消さないため）
import { commandSchemas } from '@gyakusai/script';
import type { Op, Path } from './yaml-doc.ts';

export type Step = Record<string, unknown>;

/** 省略形 `人物ID: 台詞` の人物 ID として使えないキー（schema.ts の RESERVED_KEYS と同じもの） */
export const RESERVED = new Set<string>([
  ...Object.keys(commandSchemas),
  'text',
  'color',
  'then',
  'else',
  'when',
  'by',
  'present',
  'wrong',
  'seen',
  'frames',
  'strength',
  'talk',
  'idle',
  'args',
  'auto',
  'nowait',
  'off',
  'side',
  'profiles',
]);

export interface SayValue {
  speaker: string | null;
  text: string;
  color?: string;
  /** 出し終えたら、ボタンを待たずに次へ進む */
  auto?: boolean;
}

/** 台詞（省略形・完全形のどちらでも）の中身を取り出す */
export function readSay(step: Step): SayValue {
  if ('say' in step) {
    return {
      speaker: typeof step.say === 'string' ? step.say : null,
      text: typeof step.text === 'string' ? step.text : '',
      ...(typeof step.color === 'string' ? { color: step.color } : {}),
      ...(step.auto === true ? { auto: true } : {}),
    };
  }
  const [speaker, text] = Object.entries(step)[0] ?? ['', ''];
  return { speaker, text: typeof text === 'string' ? text : '' };
}

/** 完全形の台詞を作る */
function fullSay(v: SayValue): Step {
  return {
    say: v.speaker,
    text: v.text,
    ...(v.color ? { color: v.color } : {}),
    ...(v.auto ? { auto: true } : {}),
  };
}

/** 台詞のステップを作る。人物があり、色・自動送りの指定がなければ省略形にする */
export function makeSay(v: SayValue): Step {
  if (v.speaker && !v.color && !v.auto && !RESERVED.has(v.speaker)) return { [v.speaker]: v.text };
  return fullSay(v);
}

/** 台詞の本文が入っているキー（省略形なら人物 ID、完全形なら text） */
export function sayTextKey(step: Step): string {
  return 'say' in step ? 'text' : Object.keys(step)[0]!;
}

/** 完全形の台詞を、何も失わずに省略形にできるか（say と text のほかに属性がない） */
export function canShorten(step: Step): boolean {
  if (!('say' in step)) return false;
  const speaker = step.say;
  return (
    typeof speaker === 'string' &&
    !RESERVED.has(speaker) &&
    typeof step.text === 'string' &&
    Object.keys(step).every((k) => k === 'say' || k === 'text')
  );
}

export interface SayPatch {
  speaker?: string | null;
  color?: string | undefined;
  auto?: boolean;
}

/**
 * 台詞の人物・色・自動送りを変える操作。変えた属性だけを書き換え、ほかの属性（と行末コメント）は残す。
 * 省略形で表せない値になったら、完全形に変える
 */
export function sayEditOps(path: Path, step: Step, patch: SayPatch): Op[] {
  if ('say' in step) {
    const ops: Op[] = [];
    if ('speaker' in patch) ops.push({ op: 'set', path: [...path, 'say'], value: patch.speaker });
    if ('color' in patch)
      ops.push(
        patch.color
          ? { op: 'set', path: [...path, 'color'], value: patch.color }
          : { op: 'delete', path: [...path, 'color'] },
      );
    if ('auto' in patch)
      ops.push(
        patch.auto
          ? { op: 'set', path: [...path, 'auto'], value: true }
          : { op: 'delete', path: [...path, 'auto'] },
      );
    return ops;
  }
  // 省略形
  const v = readSay(step);
  const next: SayValue = {
    ...v,
    ...('speaker' in patch ? { speaker: patch.speaker ?? null } : {}),
    ...(patch.color ? { color: patch.color } : {}),
    ...(patch.auto ? { auto: true } : {}),
  };
  if (next.color || next.auto || !next.speaker || RESERVED.has(next.speaker))
    return [{ op: 'set', path, value: fullSay(next) }];
  if (next.speaker === v.speaker) return [];
  // 人物だけを変えるときはキーの名前を変える（本文の引用符や行末コメントを残す）
  return [{ op: 'renameKey', path, from: v.speaker!, to: next.speaker }];
}

/** 完全形を省略形にする操作（できなければ空） */
export function shortenOps(path: Path, step: Step): Op[] {
  if (!canShorten(step)) return [];
  return [{ op: 'set', path, value: makeSay(readSay(step)) }];
}
