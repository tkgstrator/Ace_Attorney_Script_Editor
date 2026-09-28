// サイコ・ロック（逆転裁判2・3）の状態を持つフラグの名前。
// ロックの中身（人物・場所・錠の数・シーン）は、コンパイラ（@gyakusai/script）が psycheLock のステップを
// 普通のフラグの set に直したもの。勾玉をつきつけて挑む・錠を壊す・やめる も、フラグと分岐に直してある。
// エンジンが直接読むのは「挑戦中のロック」と「ライフが尽きたときのシーン」だけ（machine.ts の penalty）。
import type { GameState } from './types.ts';

/** 挑戦中のロックの ID（'' なら挑戦していない） */
export const LOCK_CURRENT = '__lock';
/** 挑戦中のロックの残りの錠の数 */
export const LOCK_LEFT = '__lock_left';

export type LockField = 'active' | 'count' | 'person' | 'place' | 'start' | 'quit' | 'out';

/** ロック id の欄のフラグの名前 */
export const lockFlag = (id: string, field: LockField): string => `__lock_${id}_${field}`;

/**
 * ロックを外さないままクリア（end）したときに通る印のシーンの ID の頭。元のゲームでは、ロックの相手の話題は解除の台本が
 * 話題の表を切り替えるまで先へ進まないので、ロックが有効なまま章が終わることはない。コンパイラが end の前に、
 * 有効なロックがあればこのシーン（中身は end だけ）を通るようにし、整合性チェックが「外さずにクリアできる」と報告する
 */
export const LOCK_END_PREFIX = '__lockend_';
export const lockEndScene = (id: string): string => `${LOCK_END_PREFIX}${id}`;

/** 挑戦中なら、ライフが尽きたときに入るシーン */
export function lockOutScene(s: GameState): string | null {
  const cur = s.flags[LOCK_CURRENT];
  if (typeof cur !== 'string' || cur === '') return null;
  const out = s.flags[lockFlag(cur, 'out')];
  return typeof out === 'string' && out !== '' ? out : null;
}
