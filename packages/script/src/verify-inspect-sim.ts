// 整合性チェックで、文章送りだけの場面（台詞・日時の表示・証言を聞く途中）で「詳しく調べる」のを試すかを決める。
// Rust 版（crates/aa-verify/src/defer.rs）と同じ判定にすること。
//
// 状態を変えうる証拠品を持っていて法廷記録を開ける台詞（verify-inspect.ts の inspectStop）でも、調べる場所ごとに、
// 次のどちらかなら、そこで試さなくてよい（どの場所もそうなら、止まらずに進める）。
// 1. 後に回せる: その場所で読み書きする変数と、この台詞から次に調べられる所（次の台詞・日時の表示・選択肢・
//    つきつけの要求・探偵メニュー）までの命令で読み書きする変数が重ならない。ここで調べてから進むのと、
//    進んでから次の所で調べるのとは、同じ状態になる（別のシーンへ移りうる場所は、試して元の場面に戻ったとき）。
//    試して別のシーンへ移ったときは、その場所が読む変数を間の命令が書かず、間の命令が書く変数が移る先で死んでいれば
//    （verify-flow.ts。この先で読まれる前に必ず書かれる）、ここで移るのと次の所で移るのとは同じ状態になる
// 2. 調べても状態が変わらない（すでに調べ終えている）。実際に試して確かめ、結果は読み書きする変数の値ごとに覚える
// どちらも近似ではない（試さない調べ方の結果は、試す所の結果か今の状態と同じ）。
import { Engine, heldProfiles, type CompiledScenario, type Expr, type GameState, type Instr } from '@gyakusai/core';
import { analyzeFlow, type Flow } from './verify-flow.ts';
import { DISPLAY, inspectInfo, skippable, visible } from './verify-inspect.ts';

/** 法廷記録の鍵（stage.recordLocked）を表す名前 */
const RECORD = 'r:';

/** 読み書きする名前（フラグ名・"h:証拠品"・"p:人物"・"v:ID"・"s:ID"・法廷記録の鍵 RECORD） */
interface Access { reads: Set<string>; writes: Set<string> }
/**
 * 調べる場所の読み書き。leaves: 元の場面に戻らないことがある。targets: goto・investigate で移りうる先。
 * hard: ほかの形で戻らないことがある（選ぶ場面・終わりなど）
 */
interface OptionSig extends Access { leaves: boolean; targets: string[]; hard: boolean }

function refs(e: Expr | undefined, out: Set<string>): void {
  if (!e) return;
  if (e.t === 'var') { if (e.name !== 'life') out.add(e.name); } else if (e.t === 'call') out.add(`${e.fn === 'has' ? 'h' : e.fn === 'visited' ? 'v' : 's'}:${e.arg}`);
  else if (e.t === 'not') refs(e.e, out);
  else if (e.t === 'bin') { refs(e.l, out); refs(e.r, out); }
}

/** 状態を何も読み書きしない命令か（Rust 版の Nop・Stop・Penalty） */
function quiet(sc: CompiledScenario, ins: Instr): boolean {
  return DISPLAY.has(ins.op) || ['say', 'shout', 'banner', 'card', 'wait', 'fade', 'penalty'].includes(ins.op)
    || (ins.op === 'ui' && ins.record === undefined)
    || ((ins.op === 'giveProfile' || ins.op === 'takeProfile') && !sc.characters[ins.character]?.profile);
}

/** 状態を読み書きする命令の読み書きを acc に足す。当てはまらなければ false */
function access(ins: Instr, acc: Access): boolean {
  switch (ins.op) {
    case 'set': case 'add': acc.writes.add(ins.flag); return true;
    case 'give': case 'take': acc.reads.add(`h:${ins.evidence}`); acc.writes.add(`h:${ins.evidence}`); return true;
    case 'giveProfile': case 'takeProfile': acc.reads.add(`p:${ins.character}`); acc.writes.add(`p:${ins.character}`); return true;
    case 'jumpUnless': refs(ins.cond, acc.reads); return true;
    default: return false;
  }
}

/** pc から命令の流れをたどる（jump・jumpUnless の両方の先）。visit が false を返したら、その先はたどらない */
function walk(program: Instr[], pc: number, visit: (ins: Instr | undefined, at: number) => boolean): void {
  const done = new Set<number>();
  const todo = [pc];
  while (todo.length > 0) {
    const at = todo.pop()!;
    if (done.has(at)) continue;
    done.add(at);
    const ins = program[at];
    if (!visit(ins, at) || !ins) continue;
    if (ins.op === 'jump') todo.push(ins.to);
    else if (ins.op === 'jumpUnless') todo.push(at + 1, ins.to);
    else todo.push(at + 1);
  }
}

const segCache = new WeakMap<Instr[], (Access | null)[]>();

/**
 * 台詞・日時の表示 pc から、次に調べられる所（次の台詞・日時の表示・選択肢・つきつけの要求・探偵メニュー）までの命令の
 * 読み書き。同じシーンの中だけを見る。ほかのシーンへ移る・法廷記録の鍵を変えるなどの命令を通りうるなら null
 */
function segment(sc: CompiledScenario, scene: string, pc: number): Access | null {
  const program = sc.scenes[scene]!.program;
  let table = segCache.get(program);
  if (!table) { table = []; segCache.set(program, table); }
  if (table[pc] !== undefined) return table[pc]!;
  const acc: Access = { reads: new Set(), writes: new Set() };
  let ok = true;
  walk(program, pc + 1, ins => {
    if (!ok) return false;
    if (!ins) { ok = false; return false; }
    if (ins.op === 'say' || ins.op === 'card' || ins.op === 'choice' || ins.op === 'demand') return false;
    if (ins.op === 'menu') { acc.writes.add(`v:${scene}`); return false; }
    if (ins.op === 'jump' || quiet(sc, ins) || access(ins, acc)) return true;
    ok = false;
    return false;
  });
  table[pc] = ok ? acc : null;
  return table[pc]!;
}

const sigCache = new WeakMap<CompiledScenario, Map<string, OptionSig[]>>();

/** 証拠品 id の詳しく調べるシーンの、選択肢の項目ごとの読み書き（証拠品そのものを持っているかも読む） */
function optionSigs(sc: CompiledScenario, id: string): OptionSig[] {
  let m = sigCache.get(sc);
  if (!m) { m = new Map(); sigCache.set(sc, m); }
  let v = m.get(id);
  if (v) return v;
  const program = sc.scenes[sc.evidence[id]!.inspect!]!.program;
  const choice = program[0];
  v = (choice?.op === 'choice' ? choice.options : []).map(o => {
    const sig: OptionSig = { reads: new Set([`h:${id}`]), writes: new Set(), leaves: false, targets: [], hard: false };
    refs(o.when, sig.reads);
    walk(program, o.to, ins => {
      if (ins?.op === 'inspectEnd') return false;
      if (ins && (ins.op === 'jump' || quiet(sc, ins) || access(ins, sig))) return true;
      // 法廷記録の鍵は、どの間の命令も書かない名前として扱う（間の命令に鍵を変えるものがあれば、後に回さない）
      if (ins?.op === 'ui') { sig.writes.add(RECORD); return true; }
      sig.leaves = true;
      if (ins?.op === 'goto' || ins?.op === 'investigate') sig.targets.push(ins.op === 'goto' ? ins.scene : ins.place);
      else sig.hard = true;
      return false;
    });
    return sig;
  });
  m.set(id, v);
  return v;
}

const disjoint = (a: Set<string>, b: Set<string>) => ![...a].some(x => b.has(x));

/** 調べる場所 sig と segment の読み書きが重ならないか（重ならなければ、元の場面に戻るかぎり、segment の後に回せる） */
function independent(sig: OptionSig, seg: Access | null): boolean {
  return seg !== null && disjoint(sig.writes, seg.writes) && disjoint(sig.writes, seg.reads) && disjoint(sig.reads, seg.writes);
}

const flowCache = new WeakMap<CompiledScenario, Flow>();

/**
 * 別のシーンへ移った場所を、segment の後に回せるか: 場所が読む変数を segment が書かず、segment が書く変数
 * （証拠品・人物ファイルは除く）が、移りうる先のどれでも死んでいる
 */
function deadAfterLeaving(sc: CompiledScenario, sig: OptionSig, seg: Access | null): boolean {
  if (!seg || sig.hard || !disjoint(sig.reads, seg.writes) || [...seg.writes].some(w => /^[hp]:/.test(w))) return false;
  let flow = flowCache.get(sc);
  if (!flow) { flow = analyzeFlow(sc); flowCache.set(sc, flow); }
  return sig.targets.every(t => {
    const live = new Set(flow.live(entryNode(sc, flow, t)));
    return ![...seg.writes].some(w => live.has(w));
  });
}

/** シーン・場所 id に入ったときの地点（場所なら、来たときのブロックか探偵メニュー） */
function entryNode(sc: CompiledScenario, flow: Flow, id: string): number {
  const scene = sc.scenes[id]!;
  if (scene.kind === 'testimony') return flow.testimony.get(id)!;
  if (scene.kind === 'place') return scene.enter !== undefined ? flow.base.get(id)! + scene.enter : flow.menu.get(id)!;
  return flow.base.get(id)!;
}

const SIM_LIMIT = 10_000;
/** 結果の覚え（状態が変わるか, 元の場面に戻るか, 別のシーンへ移ったか） */
const changeCache = new WeakMap<CompiledScenario, Map<string, [boolean, boolean, boolean]>>();

/**
 * inspectStop の場面で、詳しく調べるのを試さずに進めてよいか（試すべき調べ方が 1 つもない）。
 * linear は、止まらずに進める場面か（調べた後の文章送りを進めるのに使う。これ自身は試さない判定）
 */
export function inspectSkippable(sc: CompiledScenario, s: Readonly<GameState>, linear: (s: Readonly<GameState>) => boolean): boolean {
  const seg = s.mode === 'run' ? segment(sc, s.scene, s.pc) : null;
  const { effective } = inspectInfo(sc);
  let base: GameState | null = null;
  for (const id of effective) {
    if (!s.evidence.includes(id)) continue;
    const program = sc.scenes[sc.evidence[id]!.inspect!]!.program;
    const choice = program[0];
    if (choice?.op !== 'choice') return false;
    const sigs = optionSigs(sc, id);
    const skip = skippable(sc, program);
    for (const [i, o] of choice.options.entries()) {
      if (!visible(o.when, s)) continue;
      const free = independent(sigs[i]!, seg);
      if (skip[i] || (free && !sigs[i]!.leaves)) continue;
      base ??= JSON.parse(JSON.stringify(s)) as GameState;
      const [changed, returned, left] = changes(sc, base, id, i, linear);
      if ((free && returned) || !changed || (left && deadAfterLeaving(sc, sigs[i]!, seg))) continue;
      return false;
    }
  }
  return true;
}

/**
 * 証拠品 id の i 番目の場所を調べると、状態が変わるかと、元の場面に戻るか（調べるシーンの中だけを進め、戻ったところで比べる）
 */
function changes(
  sc: CompiledScenario, s: GameState, id: string, i: number, linear: (s: Readonly<GameState>) => boolean,
): [boolean, boolean, boolean] {
  let cache = changeCache.get(sc);
  if (!cache) { cache = new Map(); changeCache.set(sc, cache); }
  // 別のシーンへ移りうる場所は、移った先が今の場面と同じかどうかも結果に効くので、今の場面も見分けに入れる
  const where = optionSigs(sc, id)[i]!.leaves ? `${s.scene}:${s.pc}:${s.mode}:${s.phase}:${s.statement}` : '';
  const key = `${id}\u0001${i}\u0001${where}\u0001${sigKey(sc, s)}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const x = new Engine(sc, { version: 1, scenario: sc.id, state: JSON.parse(JSON.stringify(s)) as GameState });
  const choice = sc.scenes[sc.evidence[id]!.inspect!]!.program[0] as Extract<Instr, { op: 'choice' }>;
  // 選択肢の番号は、表示される項目だけを数える
  const n = choice.options.slice(0, i).filter(o => visible(o.when, s)).length;
  let out: [boolean, boolean, boolean];
  try {
    x.inspect(id);
    x.choose(n);
    for (let k = 0; k < SIM_LIMIT && x.state.inspectFrom && linear(x.state); k++) x.advance();
    const t = x.state;
    const back = !t.inspectFrom && t.scene === s.scene && t.pc === s.pc && t.mode === s.mode && t.phase === s.phase && t.statement === s.statement;
    out = [!!t.inspectFrom || !sameState(sc, s, t), back, !t.inspectFrom && !back];
  } catch { out = [true, false, false]; }
  cache.set(key, out);
  return out;
}

/** 結果を覚える見分け: 状態を変えうる調べるシーンで読み書きする名前の値と、法廷記録の鍵 */
function sigKey(sc: CompiledScenario, s: Readonly<GameState>): string {
  const names = new Set<string>();
  for (const id of inspectInfo(sc).effective) for (const g of optionSigs(sc, id)) for (const n of [...g.reads, ...g.writes]) names.add(n);
  const profiles = new Set(heldProfiles(sc, s));
  return [...names].sort().map(n => {
    const [k, v] = [n.slice(0, 2), n.slice(2)];
    if (k === 'h:') return s.evidence.includes(v) ? 1 : 0;
    if (k === 'p:') return profiles.has(v) ? 1 : 0;
    if (k === 'v:') return s.visited.includes(v) ? 1 : 0;
    if (k === 's:') return s.seen.includes(v) ? 1 : 0;
    if (n === RECORD) return s.stage.recordLocked ? 1 : 0;
    return JSON.stringify(s.flags[n] ?? null);
  }).join(',') + (s.stage.recordLocked ? 'L' : '');
}

/** 調べる前と後で、この先の動きに効く状態が同じか（表示・文中の値・ライフ・詳しく調べるシーンの visited は見ない） */
function sameState(sc: CompiledScenario, a: Readonly<GameState>, b: Readonly<GameState>): boolean {
  if (a.scene !== b.scene || a.pc !== b.pc || a.mode !== b.mode || a.phase !== b.phase || a.statement !== b.statement) return false;
  if (!!a.inspectFrom !== !!b.inspectFrom || a.stage.recordLocked !== b.stage.recordLocked) return false;
  const keys = new Set([...Object.keys(a.flags), ...Object.keys(b.flags)]);
  for (const k of keys) if (a.flags[k] !== b.flags[k]) return false;
  const inspectScenes = new Set(Object.values(sc.evidence).flatMap(ev => (ev.inspect ? [ev.inspect] : [])));
  const same = (x: string[], y: string[], skip?: Set<string>) => {
    const f = (l: string[]) => new Set(l.filter(v => !skip?.has(v)));
    const [p, q] = [f(x), f(y)];
    return p.size === q.size && [...p].every(v => q.has(v));
  };
  return same(a.evidence, b.evidence) && same(heldProfiles(sc, a), heldProfiles(sc, b))
    && same(a.visited, b.visited, inspectScenes) && same(a.seen, b.seen);
}
