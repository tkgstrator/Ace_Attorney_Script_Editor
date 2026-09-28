// 元の台本の命令の引数を、シナリオ YAML の値に写す純粋な関数（テストしやすいよう、表や状態に依らないもの）。
import type { Step } from './types.ts';

export type TextColor = 'white' | 'red' | 'blue' | 'green';
const COLORS: TextColor[] = ['white', 'red', 'blue', 'green'];

/** 3 color: 0 白, 1 赤, 2 青, 3 緑 */
export const colorName = (n: number): TextColor => COLORS[n] ?? 'white';

/** 11 speed: 255 は標準の 3 */
export const speedValue = (n: number): number => (n === 255 ? 3 : n);

/** 文の中の `[` は `[[` と書く */
export const escapeText = (s: string): string => s.replaceAll('[', '[[');

/** 法廷の立ち位置の背景（player の official-assets.ts の立ち位置の鍵と同じ）。机の絵もこの鍵で出る */
const STAND_BG: Record<number, string> = {
  3: 'defense',
  4: 'prosecution',
  5: 'witness',
  8: 'judge',
};
export const BG_NONE = 4095;

/** 27 bg の引数 → location の鍵。4095（背景なし）は black。0x8000 は別の表示の仕方（flag） */
export function bgKey(arg: number): { key: string; alt: boolean } {
  if (arg === BG_NONE) return { key: 'black', alt: false };
  const n = arg & 0x7fff;
  return { key: STAND_BG[n] ?? `bg${n}`, alt: (arg & 0x8000) !== 0 };
}

/** 立ち位置の鍵か（人物の stand の推定に使う） */
export const isStandKey = (key: string) => Object.values(STAND_BG).includes(key);

/** 30 char の第 1 引数: 下位 13 ビット = 人物、0x8000 / 0x4000 = 横長の背景の左 / 右の外、0x2000 = 左右反転 */
export function charArg(arg: number): {
  id: number;
  left: boolean;
  right: boolean;
  flip: boolean;
} {
  return {
    id: arg & 0x1fff,
    left: (arg & 0x8000) !== 0,
    right: (arg & 0x4000) !== 0,
    flip: (arg & 0x2000) !== 0,
  };
}

/** 23 / 24 / 25 の引数: bit15 = 人物ファイル、bit14 = 「ファイルした」の窓、下位 14 ビット = 番号 */
export function recordArg(arg: number): {
  kind: 'profile' | 'evidence';
  id: number;
  notice: boolean;
} {
  return {
    kind: arg & 0x8000 ? 'profile' : 'evidence',
    id: arg & 0x3fff,
    notice: (arg & 0x4000) !== 0,
  };
}

/** 14 name: 上位 8 ビット（下位 7 ビットまで）が名前の番号 */
export const nameArg = (arg: number): number => (arg >> 8) & 0x7f;

/** 47 anim の吹き出し（1/10 待った!、2/3/11 異議あり!、4 くらえ!）。それ以外は null */
export function shoutKind(anim: number): 'hold' | 'objection' | 'takethat' | null {
  if (anim === 1 || anim === 10) return 'hold';
  if (anim === 2 || anim === 3 || anim === 11) return 'objection';
  if (anim === 4) return 'takethat';
  return null;
}
/** 吹き出しの絵が出ている長さ（anims47.json: 60 フレームで自分で消える） */
export const SHOUT_FRAMES = 60;

/** 105 ds_fx の第 2 引数: 段 << 8 | 効果 */
export const dsFx = (arg: number) => ({ stage: arg >> 8, effect: arg & 0xff });

/** 16 flag: 値 << 15 | 組 << 8 | 番号 */
export const flagArg = (arg: number) => ({
  value: arg >> 15 === 1,
  group: (arg >> 8) & 0x7f,
  index: arg & 0xff,
});
export const flagName = (group: number, index: number) => `f_${group}_${index}`;

/** 53 if_flag の第 1 引数: フラグ << 8 | 0x80（ラベル）| 期待する値（bit0） */
export const ifFlagArg = (arg: number) => ({
  index: arg >> 8,
  label: (arg & 0x80) !== 0,
  want: (arg & 1) === 1,
});

export type FadeResult =
  | { kind: 'flash'; frames: number }
  | {
      kind: 'fade';
      dir: 'in' | 'out';
      color: 'black' | 'white';
      frames: number;
    }
  | { kind: 'native' };

/**
 * 18 fade (種類 << 8 | 間隔, 量, 対象) → フェード。明るさ 0〜16 を「間隔」フレームごとに「量」動かす。
 * 種類 1: 黒から戻す / 2: 黒へ / 3: 白から戻す / 4: 白へ / 5: 白を 1 回足す。
 * 覆っていない画面で種類 3 を始めると 0 − 量 が 5 ビットで回り込んで白くなり、すぐ戻る = 白いフラッシュ（769 8 31 で 3 フレーム）。
 * cover = 今の覆い（直前のフェードの結果）
 */
export function fadeOf(args: number[], cover: 'black' | 'white' | null): FadeResult {
  const [a0 = 0, amount = 1] = args;
  const type = a0 >> 8;
  const interval = Math.max(1, a0 & 0xff);
  const frames = (level: number) => interval * Math.ceil(level / Math.max(1, amount));
  switch (type) {
    case 1:
      return { kind: 'fade', dir: 'in', color: 'black', frames: frames(16) };
    case 2:
      return { kind: 'fade', dir: 'out', color: 'black', frames: frames(16) };
    case 3:
      if (cover === 'white') return { kind: 'fade', dir: 'in', color: 'white', frames: frames(16) };
      return { kind: 'flash', frames: frames((32 - amount) & 0x1f) || 1 };
    case 4:
      return { kind: 'fade', dir: 'out', color: 'white', frames: frames(16) };
    default:
      return { kind: 'native' };
  }
}

/** 既定の白いフラッシュの長さ（rich.ts の DEFAULT_FLASH_FRAMES と同じ） */
export const DEFAULT_FLASH = 3;

/** 文中コマンドの形 */
export const inline = {
  wait: (n: number) => `[wait ${n}]`,
  speed: (n: number) => `[speed ${n}]`,
  color: (c: TextColor) => `[color ${c}]`,
  shake: (frames: number, strength: number) => `[shake ${frames} ${Math.min(2, strength)}]`,
  flash: (frames: number) => (frames === DEFAULT_FLASH ? '[flash]' : `[flash white ${frames}]`),
  se: (id: string) => `[se ${id}]`,
  bgm: (id: string | null, frames: number) => `[bgm ${id ?? 'null'}${frames ? ` ${frames}` : ''}]`,
};

/** 元の命令をそのまま残すステップ */
export const native = (name: string, args: number[]): Step =>
  args.length ? { native: name, args } : { native: name };

/** 証言のタイトルの前後の「～」を外す（エンジンが〜で囲む） */
export const stripTilde = (s: string) => s.replace(/^[～〜]+|[～〜]+$/g, '');

/** 文中コマンドにできるステップなら、その形（show / location / native / se / bgm / flash / shake / wait） */
export function inlineOf(s: Step): string | null {
  if ('show' in s) {
    if (s.show === null) return '[show null]';
    return `[show ${s.show as string}${s.talk !== undefined ? ` ${s.talk as number} ${(s.idle ?? s.talk) as number}` : ''}]`;
  }
  if ('location' in s) return `[location ${(s.location as string | null) ?? 'null'}]`;
  if ('native' in s)
    return `[native ${s.native as string}${((s.args as number[] | undefined) ?? []).map((a) => ` ${a}`).join('')}]`;
  if ('se' in s) return inline.se(s.se as string);
  if ('bgm' in s) return inline.bgm(s.bgm as string | null, (s.frames as number | undefined) ?? 0);
  if ('flash' in s) return inline.flash((s.frames as number | undefined) ?? DEFAULT_FLASH);
  if ('shake' in s)
    return inline.shake(
      s.shake === true ? 30 : (s.shake as number),
      (s.strength as number | undefined) ?? 0,
    );
  if ('wait' in s) return inline.wait(s.wait as number);
  return null;
}
