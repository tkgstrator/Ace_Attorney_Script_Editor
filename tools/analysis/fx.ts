// 演出のステップを見分ける小道具（effects.ts・patterns.ts で使う）。

import type { StepRec, Y } from './corpus.ts';
import { lineOf } from './corpus.ts';
import { parseText } from './text.ts';

/** 演出として数えるステップの種類 */
export const FX_TYPES = [
  'shake',
  'flash',
  'se',
  'bgm',
  'bgmPause',
  'fade',
  'shout',
  'penalty',
  'showEvidence',
  'pan',
  'banner',
  'card',
] as const;

/** 並びを見るときに飛ばすステップ（表示の準備だけのもの） */
export const NOISE = new Set([
  'textbox',
  'wait',
  'location',
  'ui',
  'overlay',
  'native',
  'palette',
  'scroll',
  'set',
  'lifeRisk',
]);

/** 主人公（掛け声の主）の人物 ID */
export function playerOf(rec: StepRec): string {
  return rec.ctx.ep.data.player ?? 'phoenix';
}

/** ステップを短い記号にする（並びの型を数えるため）。数えないものは '' */
export function token(rec: StepRec): string {
  const s: Y = rec.step;
  const t = rec.type;
  const l = lineOf(rec);
  if (l) {
    const p = playerOf(rec);
    const who =
      l.speaker === null
        ? 'ナレーション'
        : l.speaker === p
          ? l.color === 'blue'
            ? '主人公の心の声'
            : '主人公'
          : l.speaker === 'judge'
            ? '裁判長'
            : '相手';
    const fx = parseText(l.raw, l.color)
      .commands.filter((c) => ['flash', 'shake', 'se'].includes(c.name))
      .map((c) => c.name);
    return `台詞(${who}${fx.length ? `+文中${[...new Set(fx)].join('/')}` : ''})`;
  }
  switch (t) {
    case 'shake':
      return `揺れ${s.strength ? `(強さ${s.strength})` : ''}`;
    case 'flash':
      return typeof s.flash === 'string' ? `フラッシュ(${s.flash})` : 'フラッシュ';
    case 'se':
      return `効果音(${s.se})`;
    case 'bgm':
      return s.bgm === null ? 'BGM停止' : 'BGM切替';
    case 'bgmPause':
      return s.bgmPause ? 'BGM一時停止' : 'BGM再開';
    case 'fade':
      return `フェード${s.fade === 'out' ? 'アウト' : 'イン'}${s.color && s.color !== 'black' ? `(${s.color})` : ''}`;
    case 'shout':
      return `吹き出し(${s.shout})`;
    case 'penalty':
      return 'ペナルティ';
    case 'showEvidence':
      return s.showEvidence === null ? '証拠品の小窓を消す' : '証拠品の小窓';
    case 'pan':
      return 'パン';
    case 'banner':
      return '大きな文字';
    case 'card':
      return '日時の表示';
    case 'give':
      return '証拠品を加える';
    case 'goto':
      return '→';
    default:
      return '';
  }
}

/** 同じ配列の中で、ステップの前後を見るための小道具 */
export function neighbors(rec: StepRec, from: number, to: number): Y[] {
  return rec.siblings.slice(Math.max(0, rec.index + from), rec.index + to + 1);
}

/** 動きの切り替え（show）が、同じ人物の動きを変えるものか（前の show と同じ人物） */
export class ShowTracker {
  private cur = new Map<number, string | null>();
  /** show ステップを渡すと、'same'（同じ人物の動き替え）か 'switch'（人物の入れ替え）を返す */
  step(arrayId: number, who: string | null): 'same' | 'switch' {
    const prev = this.cur.get(arrayId);
    this.cur.set(arrayId, who);
    return prev !== undefined && prev === who ? 'same' : 'switch';
  }
}
