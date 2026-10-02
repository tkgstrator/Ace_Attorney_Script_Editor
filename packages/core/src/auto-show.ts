import type { CompiledScenario, GameState, Instr } from './types.ts';

/**
 * 台詞で話し手の立ち絵に切り替えるか（defaults.autoShow）。
 * 心の声（青字）では切り替えない。主人公（player）の立ち絵は法廷でだけ出る（元のゲームと同じ）ので、
 * 背景を場所に変えている間（探偵パート・控え室など）は主人公の台詞でも切り替えない。
 */
export function autoShows(
  scenario: CompiledScenario,
  ins: Extract<Instr, { op: 'say' }>,
  s: GameState,
): boolean {
  if (!scenario.autoShow || !ins.speaker || ins.color === 'blue') return false;
  if (s.stage.character === ins.speaker) return false;
  return !(ins.speaker === scenario.player && s.stage.location !== null);
}
