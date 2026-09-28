// プレビューの「ここから再生」と再読み込みの補助: 編集画面の位置から始める位置を決める・編集の後に位置を合わせ直す・
// 何が起きたかを短い知らせにする
import { type CompiledScenario, mapPc, type PlayTarget, type RestoreResult } from '@gyakusai/core';
import { type SourceMap, targetForPath } from '@gyakusai/script';
import type { Restart } from './PlayControls.tsx';
import type { PlayFrom } from './play-from.ts';

/** 遊べる内容（最後に正しくコンパイルできたもの） */
export interface Good {
  scenario: CompiledScenario;
  version: number;
  /** 各命令の元になったステップの位置（「ここから再生」で使う） */
  sources: SourceMap | null;
}

/** 編集画面の位置からの「ここから再生」を、始め方にする。位置が見つからなければ理由 */
export function restartFor(
  g: Good,
  req: Extract<PlayFrom, { kind: 'path' }>,
): Extract<Restart, { kind: 'at' }> | string {
  const t = g.sources ? targetForPath(g.scenario.scenes, g.sources, req.path) : null;
  if (!t)
    return `「${req.label}」の位置がコンパイル結果に見つかりません（コンパイルエラーを直してから、もう一度押してください）`;
  // シーン・場所そのものや、証拠品を詳しく調べるブロックの中なら、シーンの名前は付けない
  const bare = t.target.kind === 'scene' || t.target.scene.startsWith('@inspect:');
  const where = bare ? '' : `シーン「${t.target.scene}」の `;
  return {
    kind: 'at',
    target: t.target,
    fresh: req.fresh,
    label: `${where}${req.label}`,
    exact: t.exact,
    base: g.scenario,
  };
}

/** 前に選んだ位置を、編集した後の内容に合わせる（命令の中身で対応を取る。合わせられなければシーンの頭） */
export function retarget(
  how: Extract<Restart, { kind: 'at' }>,
  next: CompiledScenario,
): PlayTarget {
  const t = how.target;
  if (t.kind !== 'pc' || how.base === next) return t;
  const a = how.base.scenes[t.scene];
  const b = next.scenes[t.scene];
  const m = a && b ? mapPc(a.program, b.program, t.pc) : null;
  return m ? { ...t, pc: m.pc } : { kind: 'scene', scene: t.scene };
}

export interface Notice {
  text: string;
  warn: boolean;
  detail: string[];
}

/** 再読み込み・ここから再生の結果を、短い知らせにする（直したデータなどは detail に。ツールチップで見せる） */
export function describe(
  how: Restart,
  result: RestoreResult,
  scene: string,
  notes: string[],
): Notice {
  if (result === 'at' && how.kind === 'at') {
    const state = how.fresh ? '最初の状態で' : '状態を保って';
    const near = how.exact ? '' : '（そのステップからは始められないので、それを含む所から）';
    return {
      text: `${state}、${how.label} から遊んでいます${near}`,
      warn: !how.exact,
      detail: notes,
    };
  }
  if (result === 'same' || result === 'moved') {
    const fixed = result === 'moved' ? '（編集に合わせて位置を直しました）' : '';
    return { text: `シーン「${scene}」の続きから遊んでいます${fixed}`, warn: false, detail: notes };
  }
  if (result === 'sceneStart' && how.kind === 'jump')
    return { text: `状態を保って、シーン「${scene}」の頭へ移りました`, warn: false, detail: notes };
  // 続けられなかった理由は notes の最後にある
  return {
    text: notes.at(-1) ?? '最初から始めました',
    warn: true,
    detail: notes.slice(0, -1),
  };
}
