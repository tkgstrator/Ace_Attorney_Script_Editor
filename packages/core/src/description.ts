// 証拠品・人物ファイルの説明を、今のゲームの状態で選ぶ。表示する所はすべてここを通す。
import { type ExprEnv, evalExpr } from './expr.ts';
import { stateEnv } from './state.ts';
import type { CompiledScenario, Description, GameState } from './types.ts';

/** 条件を上から評価し、満たす最初の説明を返す（どれも満たさなければ空） */
export function pickDescription(d: Description, env: ExprEnv): string {
  if (typeof d === 'string') return d;
  for (const c of d) if (c.when === undefined || evalExpr(c.when, env)) return c.text;
  return '';
}

/** 説明に書かれた文をすべて（点検用。文字列なら 1 つ、配列なら切り替えの分すべて） */
export function descriptionTexts(d: Description): string[] {
  return typeof d === 'string' ? [d] : d.map((c) => c.text);
}

/** 法廷記録の証拠品の説明（今の状態で選ぶ） */
export function evidenceDescription(scenario: CompiledScenario, s: GameState, id: string): string {
  const d = scenario.evidence[id]?.description;
  return d === undefined
    ? ''
    : pickDescription(
        d,
        stateEnv(() => s),
      );
}

/** 法廷記録の人物ファイルの説明（今の状態で選ぶ） */
export function profileDescription(scenario: CompiledScenario, s: GameState, id: string): string {
  const d = scenario.characters[id]?.profile?.description;
  return d === undefined
    ? ''
    : pickDescription(
        d,
        stateEnv(() => s),
      );
}
