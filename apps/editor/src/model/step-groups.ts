// ステップ一覧の表示の切り替えのための、ステップの分け方（台詞・分岐・演出・状態・流れ）と、
// 隠した種類の連続する行を 1 行にまとめる計算。
import { type StepKind, stepKind } from './steps.ts';

export type StepGroup = 'dialogue' | 'branch' | 'effect' | 'state' | 'flow';

export const STEP_GROUPS: { id: StepGroup; label: string; hint: string }[] = [
  { id: 'dialogue', label: '台詞', hint: '台詞・ナレーション・日時・帯・吹き出し' },
  { id: 'branch', label: '選択肢・分岐', hint: '条件分岐・選択肢・つきつけ要求・乱数' },
  { id: 'effect', label: '演出', hint: '人物・背景・BGM・効果音・画面の効果など' },
  { id: 'state', label: '状態', hint: 'フラグ・証拠品・人物ファイル・ペナルティ' },
  { id: 'flow', label: '移動・流れ', hint: 'シーン移動・探索・待つ・証言へ戻る・終わり' },
];

export const GROUP_LABELS = Object.fromEntries(STEP_GROUPS.map((g) => [g.id, g.label])) as Record<
  StepGroup,
  string
>;

const KIND_GROUP: Record<Exclude<StepKind, 'unknown' | 'native'>, StepGroup> = {
  say: 'dialogue',
  shorthand: 'dialogue',
  narrate: 'dialogue',
  card: 'dialogue',
  banner: 'dialogue',
  shout: 'dialogue',
  if: 'branch',
  choice: 'branch',
  demand: 'branch',
  random: 'branch',
  show: 'effect',
  showEvidence: 'effect',
  location: 'effect',
  bgm: 'effect',
  bgmPause: 'effect',
  se: 'effect',
  fade: 'effect',
  flash: 'effect',
  shake: 'effect',
  pan: 'effect',
  overlay: 'effect',
  scroll: 'effect',
  palette: 'effect',
  textbox: 'effect',
  ui: 'effect',
  set: 'state',
  add: 'state',
  give: 'state',
  take: 'state',
  giveProfile: 'state',
  takeProfile: 'state',
  penalty: 'state',
  goto: 'flow',
  investigate: 'flow',
  end: 'flow',
  gameover: 'flow',
  resume: 'flow',
  wait: 'flow',
};

const cache = new WeakMap<object, StepGroup | null>();

/**
 * ステップの分け方。不明なステップ・元の命令（native）は null（いつも見せる。直す必要があるかもしれないので）。
 * 同じオブジェクトは覚えておく（長い列で、1 文字の入力のたびに全部を判定し直さないため）
 */
export function stepGroup(step: unknown): StepGroup | null {
  const obj = typeof step === 'object' && step !== null ? step : null;
  if (obj && cache.has(obj)) return cache.get(obj)!;
  const kind = stepKind(step);
  const g = kind === 'unknown' || kind === 'native' ? null : KIND_GROUP[kind];
  if (obj) cache.set(obj, g);
  return g;
}

/** 列の中で見せる行（true）と隠す行（false）。expanded（開いた行）は隠さない */
export function visibleRows(
  items: readonly unknown[],
  keys: readonly string[],
  hidden: ReadonlySet<StepGroup>,
  expanded: ReadonlySet<string>,
): boolean[] {
  if (hidden.size === 0) return items.map(() => true);
  return items.map((s, i) => {
    const g = stepGroup(s);
    return g === null || !hidden.has(g) || expanded.has(keys[i]!);
  });
}

/** 描く単位: 1 行（row）か、隠した行の連続（fold: start から end まで。end を含む） */
export type Unit = { row: number } | { fold: [number, number] };

/** 見せる・隠すの並びを、描く単位にする。offset は最初の行の位置 */
export function foldUnits(visible: readonly boolean[], offset = 0): Unit[] {
  const out: Unit[] = [];
  let i = 0;
  while (i < visible.length) {
    if (visible[i]) {
      out.push({ row: offset + i });
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < visible.length && !visible[j + 1]) j++;
    out.push({ fold: [offset + i, offset + j] });
    i = j + 1;
  }
  return out;
}

/**
 * 長い列を、描き直しの単位のまとまり（[start, end)）に分ける。
 * 1 つのまとまりの単位の数はだいたい size 個。隠した行の連続の途中では切らない
 */
export function chunkRanges(visible: readonly boolean[], size: number): [number, number][] {
  const out: [number, number][] = [];
  let start = 0;
  let units = 0;
  for (let i = 0; i < visible.length; i++) {
    const continuesFold = i > 0 && !visible[i] && !visible[i - 1];
    if (!continuesFold) {
      if (units === size) {
        out.push([start, i]);
        start = i;
        units = 0;
      }
      units++;
    }
  }
  if (visible.length > start) out.push([start, visible.length]);
  return out;
}

/** 隠した行の連続の中身の数え（「演出 3・状態 1」） */
export function foldLabel(items: readonly unknown[]): string {
  const counts = new Map<StepGroup, number>();
  for (const s of items) {
    const g = stepGroup(s);
    if (g) counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  return STEP_GROUPS.filter((g) => counts.has(g.id))
    .map((g) => `${g.label} ${counts.get(g.id)}`)
    .join('・');
}
