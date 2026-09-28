// ステップ（シーンの中の 1 命令）の種類の判定と、新しく足すときのひな形。
// コマンドの一覧と説明は @gyakusai/script の zod スキーマ（commandSchemas）から取る。
import { commandSchemas } from '@gyakusai/script';
import { makeSay, RESERVED, readSay, type Step } from './say.ts';

export {
  canShorten,
  makeSay,
  readSay,
  type SayPatch,
  type SayValue,
  type Step,
  sayEditOps,
  sayTextKey,
  shortenOps,
} from './say.ts';

export type CommandName = keyof typeof commandSchemas;
export type StepKind = CommandName | 'shorthand' | 'unknown';

export const COMMAND_NAMES = Object.keys(commandSchemas) as CommandName[];

/** スキーマの説明文（describe） */
export function commandDescription(name: CommandName): string {
  return (commandSchemas[name] as { description?: string }).description ?? '';
}

export const COMMAND_LABELS: Record<CommandName, string> = {
  say: '台詞',
  narrate: 'ナレーション',
  set: 'フラグを設定',
  add: 'フラグに加算',
  give: '証拠品を渡す',
  take: '証拠品を外す',
  if: '条件分岐',
  choice: '選択肢',
  demand: 'つきつけ要求',
  goto: 'シーン移動',
  penalty: 'ペナルティ',
  shout: '吹き出し',
  banner: '帯テキスト',
  card: '日時・場所',
  showEvidence: '証拠品の小窓',
  show: '人物の表示',
  location: '場所（背景）',
  investigate: '探索へ',
  bgm: 'BGM',
  se: '効果音',
  shake: '画面の揺れ',
  flash: 'フラッシュ',
  fade: 'フェード',
  wait: '待つ',
  native: '元の命令（未対応）',
  bgmPause: 'BGM の一時停止',
  textbox: '文字の枠',
  ui: '画面の部品',
  resume: '証言へ戻る',
  scroll: '背景のスクロール',
  pan: '法廷の視点の流し',
  overlay: '重ね絵',
  random: '乱数の分岐',
  palette: '画面の色',
  giveProfile: '人物ファイルに加える',
  takeProfile: '人物ファイルから外す',
  end: 'クリア',
  gameover: 'ゲームオーバー',
};

/** 追加メニューでの並び（よく使うものから） */
export const COMMAND_GROUPS: { label: string; items: CommandName[] }[] = [
  { label: '会話', items: ['say', 'narrate', 'card', 'banner', 'shout'] },
  { label: '表示', items: ['show', 'showEvidence', 'location'] },
  { label: '分岐', items: ['if', 'choice', 'demand', 'goto', 'investigate'] },
  { label: '演出', items: ['bgm', 'se', 'shake', 'flash', 'fade', 'wait'] },
  { label: '状態', items: ['set', 'add', 'give', 'take', 'giveProfile', 'takeProfile', 'penalty'] },
  { label: '終わり', items: ['end', 'gameover'] },
];

/** 上のまとまりに入っていない、そのほかのコマンド（追加メニューの「その他のコマンド」） */
export const OTHER_COMMANDS: CommandName[] = COMMAND_NAMES.filter(
  (n) => !COMMAND_GROUPS.some((g) => g.items.includes(n)),
);

export function stepKind(step: unknown): StepKind {
  if (typeof step !== 'object' || step === null || Array.isArray(step)) return 'unknown';
  const keys = Object.keys(step);
  for (const name of COMMAND_NAMES) if (keys.includes(name)) return name;
  if (keys.length === 1 && !RESERVED.has(keys[0]!) && typeof (step as Step)[keys[0]!] === 'string')
    return 'shorthand';
  return 'unknown';
}

export type FlagValue = boolean | number | string;

/** フラグの型に合う、set の初期値（真偽は true、数値は 0、文字列は ''） */
export function flagDefault(initial: FlagValue | undefined): FlagValue {
  return typeof initial === 'number' ? 0 : typeof initial === 'string' ? '' : true;
}

/** 型ごとのフラグ（型の分からないものは真偽として扱う） */
export function flagsOfType(ctx: Pick<TemplateContext, 'flags' | 'flagValues'>, type: string) {
  return ctx.flags.filter((f) => typeof (ctx.flagValues?.[f] ?? true) === type);
}

export interface TemplateContext {
  characters: string[];
  evidence: string[];
  scenes: string[];
  places: string[];
  flags: string[];
  /** フラグの初期値（型を決める）。なければ型が分からないので、真偽のフラグとして扱う */
  flagValues?: Record<string, FlagValue>;
  /** 人物ファイルのある人物 */
  profiles?: string[];
  /** 直前の台詞の話し手（続けて書くときに引き継ぐ） */
  lastSpeaker?: string | null;
}

/** 新しく足すステップのひな形 */
export function stepTemplate(name: CommandName, ctx: TemplateContext): Step {
  const first = (list: string[], fallback: string) => list[0] ?? fallback;
  switch (name) {
    case 'say':
      return makeSay({ speaker: ctx.lastSpeaker ?? ctx.characters[0] ?? null, text: '' });
    case 'narrate':
      return { narrate: '' };
    case 'set': {
      // 真偽のフラグを優先する。フラグがなければ空（入力欄でフラグの表へ案内する）
      const flag = flagsOfType(ctx, 'boolean')[0] ?? ctx.flags[0];
      return { set: flag ? { [flag]: flagDefault(ctx.flagValues?.[flag]) } : {} };
    }
    case 'add': {
      // 数値のフラグだけ
      const flag = flagsOfType(ctx, 'number')[0];
      return { add: flag ? { [flag]: 1 } : {} };
    }
    case 'give':
      return { give: first(ctx.evidence, 'evidence') };
    case 'take':
      return { take: first(ctx.evidence, 'evidence') };
    case 'if':
      // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
      return { if: flagsOfType(ctx, 'boolean')[0] ?? 'true', then: [] };
    case 'choice':
      return {
        choice: [
          // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
          { text: '選択肢 1', then: [] },
          // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
          { text: '選択肢 2', then: [] },
        ],
      };
    case 'demand':
      return { demand: '証拠品をつきつけてください', present: {}, wrong: [] };
    case 'goto':
      return { goto: first(ctx.scenes, 'scene') };
    case 'penalty':
      return { penalty: true };
    case 'shout':
      return { shout: 'objection' };
    case 'banner':
      return { banner: '' };
    case 'card':
      return { card: '' };
    case 'showEvidence':
      return { showEvidence: first(ctx.evidence, 'evidence') };
    case 'show':
      return { show: first(ctx.characters, 'character') };
    case 'location':
      return { location: null };
    case 'investigate':
      return { investigate: first(ctx.places, 'place') };
    case 'bgm':
      return { bgm: '' };
    case 'se':
      return { se: '' };
    case 'shake':
      return { shake: true };
    case 'flash':
      return { flash: true };
    case 'fade':
      return { fade: 'out' };
    case 'wait':
      return { wait: 30 };
    case 'native':
      return { native: '', args: [] };
    case 'bgmPause':
      return { bgmPause: true };
    case 'textbox':
      return { textbox: false };
    case 'ui':
      return { ui: { record: false } };
    case 'resume':
      return { resume: 'stay' };
    case 'scroll':
      return { scroll: { y: -1 } };
    case 'pan':
      return { pan: 0, to: first(ctx.characters, 'character') };
    case 'overlay':
      return { overlay: 0 };
    case 'random':
      return { random: [[], []] };
    case 'palette':
      return { palette: 'grayscale' };
    case 'giveProfile':
      return { giveProfile: first(ctx.profiles ?? ctx.characters, 'character') };
    case 'takeProfile':
      return { takeProfile: first(ctx.profiles ?? ctx.characters, 'character') };
    case 'end':
      return { end: true };
    case 'gameover':
      return { gameover: true };
  }
}

/** カードの見出しに出す短い要約 */
export function stepSummary(step: unknown): string {
  const kind = stepKind(step);
  if (kind === 'unknown') return '（不明なステップ）';
  if (kind === 'shorthand' || kind === 'say') {
    const v = readSay(step as Step);
    return `${v.speaker ?? '（ナレーション）'}: ${v.text}`;
  }
  const s = step as Step;
  const v = s[kind];
  if (typeof v === 'string' || typeof v === 'number') return `${COMMAND_LABELS[kind]}: ${v}`;
  return COMMAND_LABELS[kind];
}

/** ステップ列の中で、index より前にある最後の台詞の話し手 */
export function lastSpeakerBefore(steps: unknown[], index: number): string | null | undefined {
  for (let i = Math.min(index, steps.length) - 1; i >= 0; i--) {
    const k = stepKind(steps[i]);
    if (k === 'say' || k === 'shorthand') return readSay(steps[i] as Step).speaker;
  }
  return undefined;
}

/** 証言（Testimony）かどうか */
export const isTestimony = (scene: unknown): scene is Record<string, unknown> =>
  typeof scene === 'object' && scene !== null && !Array.isArray(scene) && 'testimony' in scene;

/** 1 つの ID か ID の列（give / take の値）を配列にする */
export const idList = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string')
    : typeof v === 'string'
      ? [v]
      : [];
/** 配列を give / take の値に戻す（1 つなら文字列） */
export const idListValue = (ids: string[]): string | string[] => (ids.length === 1 ? ids[0]! : ids);

/** つきつけの表（demand・場所の present）のキーの候補 */
export interface PresentKey {
  id: string;
  kind: 'evidence' | 'profile';
}

/** characters のうち、人物ファイル（profile）のある人物の ID */
export function profileIds(characters: unknown): string[] {
  if (typeof characters !== 'object' || characters === null) return [];
  return Object.entries(characters as Record<string, unknown>)
    .filter(
      ([, c]) =>
        typeof c === 'object' &&
        c !== null &&
        typeof (c as Record<string, unknown>).profile === 'object',
    )
    .map(([id]) => id);
}

/**
 * つきつけの表に選べる証拠品・人物。withProfiles なら、人物ファイル（証拠品と同じ ID の人物は、表では区別できないので除く）も。
 * used（すでにあるキー）は除く
 */
export function presentKeyOptions(
  evidence: string[],
  profiles: string[],
  withProfiles: boolean,
  used: string[] = [],
): PresentKey[] {
  const out: PresentKey[] = evidence.map((id) => ({ id, kind: 'evidence' }));
  if (withProfiles)
    out.push(
      ...profiles
        .filter((id) => !evidence.includes(id))
        .map((id) => ({ id, kind: 'profile' as const })),
    );
  return out.filter((k) => !used.includes(k.id));
}
