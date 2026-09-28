// ステップの入力欄（フォーム）が扱う属性。ここにない属性は「フォームにない項目」として YAML で編集できるようにする
import type { CommandName, StepKind } from './steps.ts';

/** 専用の入力欄がなく、YAML で編集するコマンド */
export const YAML_ONLY = new Set<CommandName>([
  'native',
  'ui',
  'scroll',
  'pan',
  'overlay',
  'random',
  'heal',
  'lifeRisk',
  'psycheLock',
  'breakLock',
  'unlock',
  'quitLock',
]);

/** 種類ごとに、入力欄に出している属性（null はフォームなし＝全体を YAML で編集） */
const FORM_KEYS: Partial<Record<StepKind, string[]>> = {
  say: ['say', 'text', 'color', 'auto'],
  narrate: ['narrate'],
  set: ['set'],
  add: ['add'],
  give: ['give'],
  take: ['take'],
  giveProfile: ['giveProfile'],
  takeProfile: ['takeProfile'],
  if: ['if', 'then', 'else'],
  choice: ['choice'],
  demand: ['demand', 'present', 'wrong', 'by'],
  goto: ['goto'],
  penalty: ['penalty'],
  shout: ['shout', 'by'],
  banner: ['banner'],
  card: ['card'],
  showEvidence: ['showEvidence', 'side'],
  show: ['show', 'talk', 'idle', 'frames'],
  location: ['location'],
  investigate: ['investigate'],
  bgm: ['bgm', 'frames'],
  se: ['se'],
  shake: ['shake', 'strength'],
  flash: ['flash', 'frames'],
  fade: ['fade', 'color', 'frames', 'nowait'],
  wait: ['wait'],
  bgmPause: ['bgmPause', 'frames'],
  textbox: ['textbox'],
  resume: ['resume'],
  palette: ['palette'],
  end: ['end'],
  gameover: ['gameover'],
};

/** フォームに出ていない属性（なければ空）。省略形の台詞・フォームのない種類は空 */
export function extraKeys(kind: StepKind, step: unknown): string[] {
  const keys = FORM_KEYS[kind];
  if (!keys || typeof step !== 'object' || step === null || Array.isArray(step)) return [];
  return Object.keys(step).filter((k) => !keys.includes(k));
}

/** 専用の入力欄があるか */
export const hasForm = (kind: StepKind) => kind === 'shorthand' || kind in FORM_KEYS;

/** 記録（ID → 中身）の入力欄が扱う属性の、ほかにある属性 */
export function extraRecordKeys(value: unknown, handled: string[]): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
  return Object.keys(value).filter((k) => !handled.includes(k));
}
