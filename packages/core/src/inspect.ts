// 証拠品を「詳しく調べる」（DS 版の第 5 話の、証拠品を 3D で調べる遊び）。
// 法廷記録を開ける場面ならいつでも調べられる（探偵メニュー・つきつけの要求と、台詞・証言・選択肢・日時の表示の途中）。
// 調べ始めた場面を覚えておき、調べるブロックの最後（inspectEnd）でそこへ戻る（台詞の途中なら、その台詞に戻る）。
// ブロックの中で別のシーンへ移ったら（goto・investigate）、戻らずにそのまま進む。
import { cloneData } from './clone.ts';
import type { Beat, CompiledScenario, GameState, InspectFrame } from './types.ts';

/** 法廷記録を開ける Beat の種類（ほかに、つきつけの要求と探偵メニュー） */
const RECORD_BEATS = new Set<Beat['kind']>(['line', 'statement', 'choice', 'card']);

/** 今詳しく調べられる証拠品（持っていて、examine があるもの） */
export function inspectable(scenario: CompiledScenario, s: GameState): string[] {
  return s.evidence.filter((id) => scenario.evidence[id]?.inspect !== undefined);
}

/**
 * その種類の Beat で法廷記録を開いて詳しく調べられるか。
 * 詳しく調べている途中（inspectFrom がある）は調べられない。つきつけの要求・探偵メニューは、
 * 法廷記録を使えなくしていても（ui: record: false）調べられる（つきつける画面から調べるため）
 */
export function canInspectAt(kind: Beat['kind'], s: GameState): boolean {
  if (s.inspectFrom) return false;
  if (kind === 'demand' || kind === 'investigate') return true;
  return RECORD_BEATS.has(kind) && !s.stage.recordLocked;
}

/** Beat に足す inspect（無ければ何も足さない） */
export function inspectField(
  scenario: CompiledScenario,
  s: GameState,
  kind: Beat['kind'],
): { inspect?: string[] } {
  if (!canInspectAt(kind, s)) return {};
  const list = inspectable(scenario, s);
  return list.length ? { inspect: list } : {};
}

/** 今の場面を戻り先として覚える（表示も戻すため、舞台の中身も写しておく） */
export function inspectFrame(s: GameState): InspectFrame {
  if (s.mode === 'investigate') return { scene: s.scene, pc: s.pc, mode: 'investigate' };
  const shown = { stage: cloneData(s.stage), vars: { ...s.vars } };
  if (s.mode === 'testimony')
    return {
      scene: s.scene,
      pc: s.pc,
      mode: 'testimony',
      phase: s.phase,
      statement: s.statement,
      ...shown,
    };
  return { scene: s.scene, pc: s.pc, mode: 'run', ...shown };
}

/**
 * 調べ終えて、調べ始めた場面に戻す。探偵メニューに戻るなら true（呼び出し側で探偵メニューにする）。
 * 表示（舞台）と文中の値は調べ始めたときのものに戻す。音楽は調べている間に変えたものを残す（鳴っている音と合わせるため）。
 * 法廷記録を使えるか（ui: record）も、調べている間に変えたものを残す
 */
export function returnFromInspect(s: GameState, f: InspectFrame): boolean {
  Object.assign(s, {
    scene: f.scene,
    pc: f.pc,
    mode: f.mode === 'testimony' ? 'testimony' : 'run',
    inspectFrom: null,
    vars: { ...f.vars },
  });
  if (f.mode === 'testimony') {
    s.phase = f.phase ?? 'cross';
    s.statement = f.statement ?? 0;
  }
  // 舞台は同じオブジェクトのまま書き換える（整合性チェックが読み書きを見張っているため）
  const keep = {
    bgm: s.stage.bgm,
    bgmPaused: s.stage.bgmPaused,
    recordLocked: s.stage.recordLocked,
  };
  if (f.stage) Object.assign(s.stage, cloneData(f.stage), keep);
  else s.stage.evidence = null;
  return f.mode === 'investigate';
}
