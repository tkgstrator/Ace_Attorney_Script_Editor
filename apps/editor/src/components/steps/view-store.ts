// ステップ一覧の表示の設定（隠す種類）。ブラウザに覚えておく
import { useSyncExternalStore } from 'react';
import { STEP_GROUPS, type StepGroup } from '@/model/step-groups.ts';

export interface ViewSettings {
  /** 隠す種類 */
  hidden: ReadonlySet<StepGroup>;
}

const KEY = 'aaeditor.stepView';
const GROUP_IDS = new Set<string>(STEP_GROUPS.map((g) => g.id));

function load(): ViewSettings {
  const fallback: ViewSettings = { hidden: new Set() };
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Record<string, unknown> | null;
    if (!raw || typeof raw !== 'object') return fallback;
    const hidden = Array.isArray(raw.hidden)
      ? (raw.hidden.filter((g) => typeof g === 'string' && GROUP_IDS.has(g)) as StepGroup[])
      : [];
    return { hidden: new Set(hidden) };
  } catch {
    return fallback;
  }
}

let settings: ViewSettings = load();
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

function update(patch: Partial<ViewSettings>): void {
  settings = { ...settings, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify({ hidden: [...settings.hidden] }));
  } catch {
    /* 覚えられなくてもよい */
  }
  for (const fn of listeners) fn();
}

export const viewSettings = () => settings;

export function useViewSettings(): ViewSettings {
  return useSyncExternalStore(subscribe, viewSettings);
}

/** 種類を見せる・隠す */
export function setGroupShown(group: StepGroup, shown: boolean): void {
  const hidden = new Set(settings.hidden);
  if (shown) hidden.delete(group);
  else hidden.add(group);
  update({ hidden });
}

/** すべての種類を見せる */
export function showAllGroups(): void {
  if (settings.hidden.size > 0) update({ hidden: new Set() });
}

/** 「テキストのみ」で見せる種類（分岐の中の台詞も読めるよう、選択肢・分岐も見せる） */
const TEXT_GROUPS: ReadonlySet<StepGroup> = new Set<StepGroup>(['dialogue', 'branch']);

/** 台詞と選択肢・分岐だけを見せる（「テキストのみ」） */
export function showDialogueOnly(): void {
  update({ hidden: new Set(STEP_GROUPS.map((g) => g.id).filter((g) => !TEXT_GROUPS.has(g))) });
}

/** 「テキストのみ」の状態か */
export const isDialogueOnly = (hidden: ReadonlySet<StepGroup>) =>
  STEP_GROUPS.every((g) => hidden.has(g.id) !== TEXT_GROUPS.has(g.id));
