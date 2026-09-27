// ゲームの状態の初期値と、古いセーブデータに後から足した項目を補う処理。
import { EngineError } from './errors.ts';
import type { ExprEnv } from './expr.ts';
import { allProfiles } from './present.ts';
import type { CompiledScenario, GameState } from './types.ts';

/** 条件式から状態（ライフ・フラグ・証拠品・訪問・調べた印）を読む */
export function stateEnv(get: () => GameState): ExprEnv {
  return {
    variable: name => {
      if (name === 'life') return get().life;
      const v = get().flags[name];
      if (v === undefined) throw new EngineError(`未定義のフラグです: ${name}`);
      return v;
    },
    has: id => get().evidence.includes(id),
    visited: id => get().visited.includes(id),
    seen: id => get().seen.includes(id),
  };
}

export function initialState(scenario: CompiledScenario): GameState {
  return {
    scene: scenario.startScene, pc: 0, mode: 'run', phase: 'intro', statement: 0,
    flags: { ...scenario.flags },
    evidence: [...scenario.startEvidence],
    life: scenario.maxLife,
    visited: [],
    seen: [],
    profiles: [...(scenario.startProfiles ?? allProfiles(scenario))],
    stage: {
      character: null, location: null, evidence: null, bgm: null, fade: null, pose: null,
      textbox: null, bgmPaused: false, recordLocked: false, lifeGauge: null, scroll: null, pan: null, overlays: [], evidenceRight: false, palette: 'normal',
    },
    vars: {},
    inspectFrom: null,
  };
}

/** 古いセーブデータ（項目を足す前のもの）に、足した項目の初期値を入れる */
export function migrateState(s: GameState, scenario: CompiledScenario): GameState {
  s.seen ??= []; // 探索編の追加前
  s.inspectFrom ??= null; // 詳しく調べるの追加前
  if (s.profiles === undefined) s.profiles = [...(scenario.startProfiles ?? allProfiles(scenario))];
  // 「profile のある全員」（null）は一覧にする（載せる・外すが、全員を基に働くように）
  if (s.profiles === null) s.profiles = allProfiles(scenario);
  const st = s.stage;
  st.evidence ??= null; // 証拠品の小窓の追加前
  st.bgm ??= null; // 音の追加前
  st.fade ??= null;
  st.pose ??= null;
  st.textbox ??= null;
  st.bgmPaused ??= false;
  st.recordLocked ??= false;
  st.lifeGauge ??= null;
  st.scroll ??= null;
  st.pan ??= null;
  st.overlays ??= [];
  st.evidenceRight ??= false;
  st.palette ??= 'normal';
  return s;
}
