// エディタの「ここから再生」: 状態（フラグ・証拠品など）はそのままに、位置だけをシナリオの途中に置いて遊び始める。
// 途中から始めると、そこまでの背景・人物・音楽などが出ていないので、同じブロックの前の演出の命令を
// 上から順に（分岐は見ずに）当てて、画面をだいたい作っておく。フラグなどは変えない。
import { autoShows } from './auto-show.ts';
import { cloneData } from './clone.ts';
import { Engine, EngineError } from './engine.ts';
import { enterStatement, execSimple } from './exec.ts';
import { inspectFrame } from './inspect.ts';
import { plainBgm } from './rich.ts';
import type { CompiledScenario, EngineEvent, GameState, Instr, PlayTarget } from './types.ts';

/** 画面の見た目だけを変える命令（途中から始めるときに、前にあるものを当てる） */
const DISPLAY_OPS = new Set<Instr['op']>([
  'location',
  'show',
  'palette',
  'overlay',
  'textbox',
  'bgm',
  'bgmPause',
  'showEvidence',
  'ui',
  'lifeRisk',
  'locks',
]);

/**
 * s（直してある状態）の位置を target にしたエンジンを作る。作れなければ EngineError などを投げる。
 * s は書き換える。notes には、気をつけること（隠し証言など）を足す
 */
export function engineAt(
  next: CompiledScenario,
  s: GameState,
  target: PlayTarget,
  notes: string[],
): Engine {
  const sc = next.scenes[target.scene];
  if (!sc) throw new EngineError(`シーン「${target.scene}」がありません`);
  const snapshot = () => ({ version: 1 as const, scenario: next.id, state: cloneData(s) });
  if (target.kind === 'scene') {
    // 探偵メニューの状態なら、コンストラクタは命令を実行しない。そこから jumpTo で入り直す
    s.mode = 'investigate';
    s.inspectFrom = null;
    const engine = new Engine(next, snapshot());
    engine.jumpTo(target.scene);
    return engine;
  }
  // 詳しく調べるシーンなら、終えたら今の場面に戻るようにする
  const inspecting = Object.values(next.evidence).some((e) => e.inspect === target.scene);
  const from = inspecting ? (s.inspectFrom ?? inspectFrame(s)) : null;
  const leavingPlace = next.scenes[s.scene]?.kind === 'place' && sc.kind !== 'place';
  s.scene = target.scene;
  s.pc = 0;
  s.vars = {};
  s.inspectFrom = from;
  s.stage.evidence = null;
  if (leavingPlace) {
    s.stage.location = null;
    s.stage.character = null;
  }
  if (sc.kind !== 'place' && !s.visited.includes(sc.id)) s.visited.push(sc.id);

  if (target.kind === 'statement') {
    if (sc.kind !== 'testimony') throw new EngineError(`証言のシーンではありません: ${sc.id}`);
    const st = sc.statements[target.statement];
    if (!st) throw new EngineError(`証言 ${target.statement + 1} がありません`);
    if (st.when)
      notes.push(`証言「${st.id}」は条件で隠れることがあります（条件は見ずに出しました）`);
    const bad = enterStatement(sc, s, 'cross', target.statement, []);
    if (bad) throw new EngineError(`証言の前のブロックに止まる命令があります: ${bad}`);
    return new Engine(next, snapshot());
  }

  const program = sc.program;
  if (!program[target.pc]) throw new EngineError(`${sc.id} の命令 ${target.pc} がありません`);
  if (sc.kind === 'place') {
    s.stage.location = sc.background;
    s.stage.character = null;
  }
  if (sc.kind === 'testimony') {
    // ゆさぶり・つきつけなどの後は、その証言（分からなければ最初の証言）の尋問に戻る
    s.phase = 'cross';
    s.statement = target.statement ?? 0;
    s.stage.character = sc.witness;
    s.stage.location = null;
    s.stage.pose = null;
  }
  prepareStage(next, program, blockStart(sc.kind, program, target.pc), target.pc, s);
  s.mode = 'run';
  s.pc = target.pc;
  return new Engine(next, snapshot());
}

/** pc を含むブロックの始め（証言・場所の命令列は、ブロックごとに resume・menu で終わる） */
function blockStart(kind: string, program: readonly Instr[], pc: number): number {
  if (kind === 'dialogue') return 0;
  let i = pc;
  while (i > 0 && program[i - 1]!.op !== 'resume' && program[i - 1]!.op !== 'menu') i--;
  return i;
}

/** from から to の手前までの、画面の見た目を変える命令を順に当てる（分岐は見ない） */
function prepareStage(
  next: CompiledScenario,
  program: readonly Instr[],
  from: number,
  to: number,
  s: GameState,
): void {
  const events: EngineEvent[] = [];
  for (let i = from; i < to; i++) {
    const ins = program[i]!;
    if (DISPLAY_OPS.has(ins.op)) execSimple(ins, s, events);
    else if (ins.op === 'fade') s.stage.fade = ins.dir === 'out' ? ins.color : null;
    else if (ins.op === 'say') {
      // エンジンと同じく、話し手を出す
      if (autoShows(next, ins, s)) {
        s.stage.character = ins.speaker;
        s.stage.pose = null;
      }
      for (const m of plainBgm(ins.text)) s.stage.bgm = m;
    }
  }
}
