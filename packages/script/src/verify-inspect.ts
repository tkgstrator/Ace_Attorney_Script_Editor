// 整合性チェックで、証拠品を「詳しく調べる」操作をまとめる。
//
// 詳しく調べるシーンは、調べる場所の選択肢（最後に「やめる」）から始まり、各場所のブロックの終わりで
// 調べ始めた場面へ戻る（コンパイラの compile-inspect.ts）。そこで、
// - 「詳しく調べる → 場所を選ぶ」を 1 つの操作にする（選択肢の場面は、いつでも「やめる」で元の場面に戻れるので、
//   状態として持たなくても、抜け出せるかの判定は変わらない）
// - 状態を何も変えずに戻るだけの場所（台詞・表示だけのブロック）と「やめる」は、元の場面に戻るだけなので試さない
// 法廷記録はいつでも開けるので、台詞・証言・選択肢・日時の表示の途中でも調べられる。文章送りだけの場面は
// 状態として持たずにまとめて進めるが、状態を変えうる証拠品（effective）を持っていて法廷記録を開けるときは、
// そこで止まって「詳しく調べる」も試す（持っていない・法廷記録を開けないなら、今までどおりまとめて進める）
import {
  type Beat,
  type CompiledScenario,
  canInspectAt,
  type Engine,
  evalExpr,
  type GameState,
  type Instr,
} from '@gyakusai/core';

/**
 * ブロックの中で、状態（キーに入るもの）を変えない命令。人物ファイルの出し入れと、法廷記録を使えるかの ui は
 * 状態を変える（人物ファイルはつきつけに、法廷記録の鍵は詳しく調べられるかに効く）
 */
const PURE = new Set<Instr['op']>([
  'say',
  'shout',
  'banner',
  'card',
  'wait',
  'fade',
  'showEvidence',
  'palette',
  'pan',
  'overlay',
  'scroll',
  'textbox',
  'bgmPause',
  'show',
  'location',
  'bgm',
  'se',
  'shake',
  'flash',
  'penalty',
  'heal',
  'lifeRisk',
  'locks',
  'jump',
  'jumpUnless',
]);
/** 状態を変えない命令か（profile の無い人物の人物ファイルの出し入れは、つきつけに効かないので変えない） */
const pure = (sc: CompiledScenario, ins: Instr) =>
  PURE.has(ins.op) ||
  (ins.op === 'ui' && ins.record === undefined) ||
  ((ins.op === 'giveProfile' || ins.op === 'takeProfile') &&
    !sc.characters[ins.character]?.profile);

/** pc から、止まって選ぶ場面も状態を変える命令も通らずに、どの道でも inspectEnd に着くか */
function pureBlock(sc: CompiledScenario, program: Instr[], pc: number): boolean {
  const done = new Set<number>();
  const todo = [pc];
  while (todo.length > 0) {
    const at = todo.pop()!;
    if (done.has(at)) continue;
    done.add(at);
    const ins = program[at];
    if (!ins) return false;
    if (ins.op === 'inspectEnd') continue;
    if (!pure(sc, ins)) return false;
    if (ins.op === 'jump') todo.push(ins.to);
    else if (ins.op === 'jumpUnless') todo.push(at + 1, ins.to);
    else todo.push(at + 1);
  }
  return true;
}

/**
 * 詳しく調べると状態を変えうる証拠品（調べる場所のどれかが、状態を変える命令を通る）と、
 * 詳しく調べられる証拠品すべて（証拠品の定義の順）
 */
export function inspectInfo(sc: CompiledScenario): { effective: string[]; all: string[] } {
  let v = infoCache.get(sc);
  if (!v) {
    const all = Object.keys(sc.evidence).filter(
      (id) => sc.evidence[id]!.inspect && sc.scenes[sc.evidence[id]!.inspect!],
    );
    const effective = all.filter((id) => {
      const program = sc.scenes[sc.evidence[id]!.inspect!]!.program;
      return program[0]?.op !== 'choice' || skippable(sc, program).some((skip) => !skip);
    });
    v = { effective, all };
    infoCache.set(sc, v);
  }
  return v;
}
const infoCache = new WeakMap<CompiledScenario, { effective: string[]; all: string[] }>();

/** 文章送りだけの場面の Beat の種類（命令・証言の段階から。Beat を作らずに判定する） */
export function linearKind(sc: CompiledScenario, s: Readonly<GameState>): Beat['kind'] | null {
  if (s.mode === 'testimony') return s.phase === 'reading' ? 'statement' : null;
  const op = s.mode === 'run' ? sc.scenes[s.scene]?.program[s.pc]?.op : undefined;
  return op === 'say' ? 'line' : op === 'card' ? 'card' : null;
}

/** 表示だけで状態を何も変えない命令（Rust 版で Nop になるもの） */
export const DISPLAY = new Set<Instr['op']>([
  'showEvidence',
  'palette',
  'pan',
  'overlay',
  'scroll',
  'textbox',
  'bgmPause',
  'show',
  'location',
  'bgm',
  'se',
  'shake',
  'flash',
  'lifeRisk',
  'locks',
]);
const STOPS = new Set<Instr['op']>(['say', 'shout', 'banner', 'card', 'wait']);
const deferCache = new WeakMap<Instr[], boolean[]>();

/**
 * 台詞・日時の表示のうち、詳しく調べるのを後ろに回せるもの: その後に、表示だけの命令と止まる命令（台詞・吹き出しなど）
 * だけを通って、次の台詞・日時の表示に着く。その間は状態が何も変わらないので、ここで調べるのと、次の台詞で調べるのは
 * 同じ結果になる（調べた後に別のシーンへ移るときも、移る前の状態が同じ）。止まるのは、表示が続くかたまりの最後の台詞だけでよい
 */
function deferrable(sc: CompiledScenario, program: Instr[]): boolean[] {
  const v = deferCache.get(program);
  if (v) return v;
  const quietOp = (ins: Instr) =>
    DISPLAY.has(ins.op) ||
    (ins.op === 'fade' && !ins.wait) ||
    (ins.op === 'ui' && ins.record === undefined) ||
    ((ins.op === 'giveProfile' || ins.op === 'takeProfile') &&
      !sc.characters[ins.character]?.profile);
  const stopOp = (ins: Instr) => STOPS.has(ins.op) || (ins.op === 'fade' && ins.wait);
  const out = new Array<boolean>(program.length).fill(false);
  // 後ろから: next = この位置より後で、表示だけの命令・止まる命令を飛ばして最初に着く台詞・日時の表示があるか
  let next = false;
  for (let pc = program.length - 1; pc >= 0; pc--) {
    const ins = program[pc]!;
    const record = ins.op === 'say' || ins.op === 'card';
    if (record) out[pc] = next;
    if (record) next = true;
    else if (!quietOp(ins) && !stopOp(ins)) next = false;
  }
  deferCache.set(program, out);
  return out;
}

/**
 * 文章送りだけの場面で、詳しく調べるために止まるか（状態を変えうる証拠品を持っていて、法廷記録を開ける）。
 * 表示が続くかたまりの途中の台詞では止まらない（deferrable）。読んだ証拠品・法廷記録の鍵は、操作の結果のメモに記録される
 */
export function inspectStop(sc: CompiledScenario, s: Readonly<GameState>): boolean {
  const { effective } = inspectInfo(sc);
  if (effective.length === 0) return false;
  const kind = linearKind(sc, s);
  if (kind === null || (kind !== 'statement' && deferrable(sc, sc.scenes[s.scene]!.program)[s.pc]))
    return false;
  return canInspectAt(kind, s as GameState) && effective.some((id) => s.evidence.includes(id));
}

/**
 * 文章送りだけの場面で、詳しく調べられる（入れる）シーンを記録する（到達しないシーンの報告に使う）。
 * まだ記録していないシーンの証拠品だけを調べる（記録し終えたら、証拠品・法廷記録の鍵を読まない）
 */
export function markInspect(
  sc: CompiledScenario,
  s: Readonly<GameState>,
  passed: Set<string>,
): void {
  const { all } = inspectInfo(sc);
  const todo = all.filter((id) => !passed.has(sc.evidence[id]!.inspect!));
  if (todo.length === 0) return;
  const kind = linearKind(sc, s);
  if (kind === null || !canInspectAt(kind, s as GameState)) return;
  for (const id of todo) if (s.evidence.includes(id)) passed.add(sc.evidence[id]!.inspect!);
}

/** 操作。d は、同じ場面で同じ操作かを見分ける名前（操作の結果のメモに使う） */
export interface Act {
  d: string;
  f: (e: Engine) => void;
}

const cache = new WeakMap<Instr[], boolean[]>();

/** 詳しく調べるシーンの、選択肢の項目ごとの「試さなくてよいか」 */
export function skippable(sc: CompiledScenario, program: Instr[]): boolean[] {
  let v = cache.get(program);
  if (!v) {
    const choice = program[0];
    v = choice?.op === 'choice' ? choice.options.map((o) => pureBlock(sc, program, o.to)) : [];
    cache.set(program, v);
  }
  return v;
}

/**
 * 今の場面で試す「詳しく調べる」操作。調べる証拠品と場所の組ごとに 1 つ。
 * passed には、調べられる（入れる）シーンを記録する（到達しないシーンの報告に使う）
 */
export function inspectActions(
  sc: CompiledScenario,
  e: Engine,
  ids: string[],
  passed?: Set<string>,
): Act[] {
  const out: Act[] = [];
  for (const id of ids) {
    const sceneId = sc.evidence[id]?.inspect;
    const program = sceneId ? sc.scenes[sceneId]?.program : undefined;
    if (!sceneId || !program) continue;
    passed?.add(sceneId);
    const choice = program[0];
    if (choice?.op !== 'choice') {
      out.push({ d: `i${id}`, f: (x) => x.inspect(id) });
      continue;
    }
    const skip = skippable(sc, program);
    // 表示される項目の番号（エンジンの選択肢の番号は、表示される項目だけを数える）
    let shown = 0;
    choice.options.forEach((o, i) => {
      if (!visible(o.when, e.state)) return;
      const n = shown++;
      if (!skip[i])
        out.push({
          d: `i${id}:${n}`,
          f: (x) => {
            x.inspect(id);
            x.choose(n);
          },
        });
    });
  }
  return out;
}

export function visible(
  when: Parameters<typeof evalExpr>[0] | undefined,
  s: Readonly<GameState>,
): boolean {
  if (!when) return true;
  return !!evalExpr(when, {
    variable: (n) => (n === 'life' ? s.life : s.flags[n]!),
    has: (id) => s.evidence.includes(id),
    visited: (id) => s.visited.includes(id),
    seen: (id) => s.seen.includes(id),
  });
}
