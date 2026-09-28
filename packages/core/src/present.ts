// 法廷記録の証拠品・人物ファイルをつきつける所の計算（状態は変えない）。
// 人物ファイルをつきつけられるのは、探偵パートの人物（場所の present）と、人物ファイルも認めるつきつけの要求（demand の profiles）。
// 尋問では証拠品だけ。表に無い人物ファイルは、証拠品と同じく見当違いの反応になる。
import type { CompiledScenario, GameState } from './types.ts';

/** 法廷記録の項目の種類 */
export type RecordKind = 'evidence' | 'profile';

/** 人物ファイルに載っている人物（載せた順。profile の無い人物は除く） */
export function heldProfiles(scenario: CompiledScenario, s: GameState): string[] {
  const list = s.profiles ?? allProfiles(scenario);
  return list.filter((id) => scenario.characters[id]?.profile);
}

/** profile のある人物すべて（人物の定義の順） */
export function allProfiles(scenario: CompiledScenario): string[] {
  return Object.entries(scenario.characters)
    .filter(([, c]) => c.profile)
    .map(([id]) => id);
}

/** ID の種類の既定（人物の ID で証拠品の ID でなければ人物ファイル、そうでなければ証拠品） */
export function kindOf(scenario: CompiledScenario, id: string): RecordKind {
  return id in scenario.characters && !(id in scenario.evidence) ? 'profile' : 'evidence';
}

/** その項目を法廷記録に持っているか */
export function holds(
  scenario: CompiledScenario,
  s: GameState,
  id: string,
  kind: RecordKind,
): boolean {
  if (kind === 'evidence') return s.evidence.includes(id);
  return !!scenario.characters[id]?.profile && (s.profiles ?? allProfiles(scenario)).includes(id);
}

/** 文中の {evidence} に差し込む名前（人物ファイルなら人物ファイルでの表示名） */
export function recordName(scenario: CompiledScenario, id: string, kind: RecordKind): string {
  if (kind === 'evidence') return scenario.evidence[id]?.name ?? id;
  const c = scenario.characters[id];
  return c?.profile?.name ?? c?.name ?? id;
}
