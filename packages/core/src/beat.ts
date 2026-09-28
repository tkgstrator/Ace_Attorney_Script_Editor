// 状態から、今の表示単位（Beat）を作る。状態は変えない。
import { EngineError } from './errors.ts';
import { inspectField } from './inspect.ts';
import type {
  Beat,
  CompiledScenario,
  Expr,
  GameState,
  Instr,
  ResumeTarget,
  TestimonyScene,
} from './types.ts';

type Test = (e: Expr | undefined) => boolean;

/** 文中の {名前} を、一時的な値・ライフ・フラグの値に置き換える */
export function interpolate(text: string, s: GameState): string {
  return text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (m, key: string) => {
    if (key in s.vars) return s.vars[key]!;
    if (key === 'life') return String(s.life);
    if (key in s.flags) return String(s.flags[key]);
    return m;
  });
}

export const visibleOptions = <O extends { when?: Expr }>(ins: { options: O[] }, test: Test): O[] =>
  ins.options.filter((o) => test(o.when));

/** 条件（when）が真の証言の番号 */
export function visibleStatements(t: TestimonyScene, test: Test): number[] {
  const out: number[] = [];
  t.statements.forEach((st, i) => {
    if (test(st.when)) out.push(i);
  });
  return out;
}

export function firstVisible(t: TestimonyScene, test: Test): number {
  const v = visibleStatements(t, test);
  if (v.length === 0) throw new EngineError(`${t.id} に表示できる証言がありません`);
  return v[0]!;
}

export const nextVisible = (t: TestimonyScene, from: number, test: Test): number | null =>
  visibleStatements(t, test).find((i) => i > from) ?? null;

/** 尋問のブロックから証言へ戻るときの行き先: 証言の番号 / 実行するブロック / 尋問開始の表示 */
export type ResumeStep = { statement: number } | { run: number } | 'crossIntro';

export function resumeStep(
  t: TestimonyScene,
  s: GameState,
  to: ResumeTarget,
  test: Test,
): ResumeStep {
  if (to === 'crossIntro') return 'crossIntro';
  if (to === 'afterReading') return t.after !== undefined ? { run: t.after } : 'crossIntro';
  if (to === 'first') return { statement: firstVisible(t, test) };
  if (to === 'stay')
    return {
      statement: test(t.statements[s.statement]?.when) ? s.statement : firstVisible(t, test),
    };
  const next = nextVisible(t, s.statement, test);
  if (next !== null) return { statement: next };
  return t.loop !== undefined ? { run: t.loop } : { statement: firstVisible(t, test) };
}

export function testimonyBeat(
  scenario: CompiledScenario,
  t: TestimonyScene,
  s: GameState,
  test: Test,
): Beat {
  const sub = `〜${interpolate(t.title, s)}〜`;
  if (s.phase === 'intro') return { kind: 'banner', text: '証言開始', sub, testimony: 'reading' };
  if (s.phase === 'crossIntro')
    return { kind: 'banner', text: '尋問開始', sub, testimony: 'cross' };
  const visible = visibleStatements(t, test);
  const st = t.statements[s.statement]!;
  return {
    kind: 'statement',
    cross: s.phase === 'cross',
    witness: t.witness,
    name: scenario.characters[t.witness]?.name ?? t.witness,
    title: t.title,
    text: interpolate(st.text, s),
    index: visible.indexOf(s.statement),
    count: visible.length,
    canPress: s.phase === 'cross' && st.press !== undefined,
    ...inspectField(scenario, s, 'statement'),
  };
}

/** 命令で止まっているときの Beat */
export function instrBeat(scenario: CompiledScenario, ins: Instr, s: GameState, test: Test): Beat {
  switch (ins.op) {
    case 'say':
      return {
        kind: 'line',
        speaker: ins.speaker,
        name: ins.speaker ? (scenario.characters[ins.speaker]?.name ?? ins.speaker) : null,
        text: interpolate(ins.text, s),
        color: ins.color,
        ...(ins.auto ? { auto: true } : {}),
        ...inspectField(scenario, s, 'line'),
      };
    case 'shout':
      return { kind: 'shout', shout: ins.kind, by: ins.by };
    case 'banner':
      return { kind: 'banner', text: interpolate(ins.text, s) };
    case 'card':
      return { kind: 'card', text: interpolate(ins.text, s), ...inspectField(scenario, s, 'card') };
    case 'choice':
      return {
        kind: 'choice',
        options: visibleOptions(ins, test).map((o) => interpolate(o.text, s)),
        ...inspectField(scenario, s, 'choice'),
      };
    case 'pick': {
      const shown = visibleOptions(ins, test);
      return {
        kind: 'pick',
        prompt: interpolate(ins.prompt, s),
        images: ins.images,
        areas: shown.flatMap((o) =>
          o.kind === 'area' && o.area ? [{ area: o.area, image: o.image ?? null }] : [],
        ),
        miss: shown.some((o) => o.kind === 'miss'),
        quit: shown.some((o) => o.kind === 'quit'),
      };
    }
    case 'demand':
      return {
        kind: 'demand',
        prompt: interpolate(ins.prompt, s),
        name: ins.speaker ? (scenario.characters[ins.speaker]?.name ?? ins.speaker) : null,
        ...inspectField(scenario, s, 'demand'),
        ...(ins.profiles ? { profiles: true } : {}),
        ...(ins.giveUp !== undefined ? { giveUp: true } : {}),
      };
    case 'fade':
      return { kind: 'fade', dir: ins.dir, color: ins.color, frames: ins.frames };
    case 'wait':
      return { kind: 'wait', frames: ins.frames };
    case 'end':
      return { kind: 'end' };
    case 'gameover':
      return { kind: 'gameover' };
    default:
      throw new EngineError(`停止しない命令で止まっています: ${ins.op}`);
  }
}
