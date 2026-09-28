// 整合性チェックの下調べ（verify-flow.ts の補助）: 条件式・if のかたまりが、どの変数の値で結果が変わるかを求める。
//
// 1. 式が本当に読む変数: 真偽の変数だけの式なら、真理値表で調べる。
//    例: (not a and b) or (not a and not b) は b によらない（a だけを読む）
// 2. if のかたまりのまとめ: if から始まり、止まって選ぶ場面・シーンの移動などのない命令だけが続いて、
//    どの道も同じ命令（出口）に着くかたまりを、入りから出口への 1 本の辺とみなす。
//    読む変数の値の組み合わせをすべて試し、出口での変数の値に効く変数だけを「読む」とする。
//    例: 「初めて来たか」のフラグで、初回だけ台詞を出してフラグを立てるかたまりは、
//        出口ではどちらでもフラグが立っているので、そのフラグを読まないのと同じ
// どちらも近似ではなく、この先の動き（選べる操作・行き先）が同じになる場合だけを同じとみなす。
import { evalExpr, type CompiledScenario, type Expr, type Instr, type Value } from '@gyakusai/core';

const MAX_VARS = 12;
const MAX_WORK = 2_000_000;

/** 真偽の値しか取らないフラグ（初めの値が真偽で、set でも真偽しか入れず、add しない） */
export function booleanFlags(sc: CompiledScenario): Set<string> {
  const out = new Set(
    Object.entries(sc.flags)
      .filter(([, v]) => typeof v === 'boolean')
      .map(([k]) => k),
  );
  for (const scene of Object.values(sc.scenes)) {
    for (const ins of scene.program) {
      if (ins.op === 'set' && typeof ins.value !== 'boolean') out.delete(ins.flag);
      if (ins.op === 'add') out.delete(ins.flag);
    }
  }
  return out;
}

/** 式が参照する名前（フラグ名・"v:ID"・"s:ID"・"h:証拠品"） */
function refs(e: Expr | undefined, out: Set<string>): Set<string> {
  if (!e) return out;
  switch (e.t) {
    case 'var':
      out.add(e.name);
      break;
    case 'call':
      out.add(`${e.fn === 'visited' ? 'v' : e.fn === 'seen' ? 's' : 'h'}:${e.arg}`);
      break;
    case 'not':
      refs(e.e, out);
      break;
    case 'bin':
      refs(e.l, out);
      refs(e.r, out);
      break;
    case 'lit':
      break;
  }
  return out;
}

/** 真偽として数え上げられる名前か */
const isBool = (bool: Set<string>, name: string) => /^[vsh]:/.test(name) || bool.has(name);

/** 値の組から式を評価する */
function evaluate(e: Expr, val: Map<string, Value>): boolean {
  return !!evalExpr(e, {
    variable: (n) => val.get(n) ?? false,
    has: (id) => val.get(`h:${id}`) === true,
    visited: (id) => val.get(`v:${id}`) === true,
    seen: (id) => val.get(`s:${id}`) === true,
  });
}

/** 式が本当に読む変数（証拠品の h: は除く）。真偽の変数だけの式なら真理値表で調べ、そうでなければ出てくる変数すべて */
export function exprDeps(e: Expr | undefined, bool: Set<string>): string[] {
  const names = [...refs(e, new Set())];
  const vars = names.filter((n) => !n.startsWith('h:') && n !== 'life');
  if (!e || vars.length === 0) return vars;
  if (names.length > MAX_VARS || !names.every((n) => isBool(bool, n))) return vars;
  const val = new Map<string, Value>();
  return vars.filter((v) => {
    const others = names.filter((n) => n !== v);
    for (let m = 0; m < 1 << others.length; m++) {
      others.forEach((n, i) => val.set(n, ((m >> i) & 1) === 1));
      val.set(v, true);
      const a = evaluate(e, val);
      val.set(v, false);
      const b = evaluate(e, val);
      if (a !== b) return true;
    }
    return false;
  });
}

/** かたまりの中に置ける、止まって選ぶことも移動することもない命令（表示・音・演出・台詞など） */
const QUIET = new Set<Instr['op']>([
  'say',
  'shout',
  'banner',
  'card',
  'wait',
  'fade',
  'showEvidence',
  'palette',
  'giveProfile',
  'takeProfile',
  'pan',
  'overlay',
  'scroll',
  'textbox',
  'ui',
  'bgmPause',
  'show',
  'location',
  'bgm',
  'se',
  'shake',
  'flash',
  'penalty',
  'set',
  'jump',
  'jumpUnless',
]);

export interface Summary {
  /** 出口の pc */
  exit: number;
  /** 出口での値に効く（読む）変数 */
  gen: string[];
  /** 出口での値が、入りでの自分の値によらない変数（書き込むとみなす） */
  def: string[];
}

/**
 * pc の if（jumpUnless）から始まるかたまりをまとめる。まとめられなければ null。
 * 入りでの値は、読む変数は数え上げ、書くだけの変数は「入りのまま」の印（IN）で表す
 */
export function summarize(program: Instr[], pc: number, bool: Set<string>): Summary | null {
  // かたまりの範囲と出口を探す（飛び先は前へ進むものだけ。後ろへ戻るものがあれば、まとめない）
  const inside = new Set<number>(),
    exits = new Set<number>();
  const read = new Set<string>(),
    written = new Set<string>();
  const todo = [pc];
  while (todo.length > 0) {
    const at = todo.pop()!;
    if (inside.has(at) || exits.has(at)) continue;
    const ins = program[at];
    if (!ins || !QUIET.has(ins.op)) {
      exits.add(at);
      continue;
    }
    inside.add(at);
    if (inside.size > 5000) return null;
    if (ins.op === 'jump' || ins.op === 'jumpUnless') {
      if (ins.to <= at) return null;
      todo.push(ins.to);
      if (ins.op === 'jumpUnless') {
        refs(ins.cond, read);
        todo.push(at + 1);
      }
      continue;
    }
    if (ins.op === 'set') written.add(ins.flag);
    todo.push(at + 1);
  }
  if (exits.size !== 1) return null;
  const exit = [...exits][0]!;
  if (exit >= program.length) return null;
  const inputs = [...read];
  if (inputs.length > MAX_VARS || inputs.includes('life') || !inputs.every((n) => isBool(bool, n)))
    return null;
  if ((1 << inputs.length) * inside.size > MAX_WORK) return null;

  // 読む変数の値の組ごとに、かたまりを実行して出口での値を求める
  const tracked = [...new Set([...inputs, ...written])].filter((n) => !n.startsWith('h:'));
  const IN = '\u0000入りのまま';
  const run = (m: number): (Value | string)[] => {
    const val = new Map<string, Value>();
    inputs.forEach((n, i) => val.set(n, ((m >> i) & 1) === 1));
    for (const n of written) if (!val.has(n)) val.set(n, IN);
    let at = pc;
    while (at !== exit) {
      const ins = program[at]!;
      if (ins.op === 'jump') at = ins.to;
      else if (ins.op === 'jumpUnless') at = evaluate(ins.cond, val) ? at + 1 : ins.to;
      else {
        if (ins.op === 'set') val.set(ins.flag, ins.value);
        at++;
      }
    }
    return tracked.map((n) => val.get(n)!);
  };
  const results = Array.from({ length: 1 << inputs.length }, (_, m) => run(m));

  const gen: string[] = [],
    def: string[] = [];
  tracked.forEach((name, t) => {
    const i = inputs.indexOf(name);
    let own = false,
      effect = false;
    if (i < 0) own = results.some((r) => r[t] === IN); // 書くだけの変数: どこかの道で書かなければ、入りの値が残る
    for (let m = 0; m < results.length && i >= 0; m++) {
      if ((m >> i) & 1) continue;
      const a = results[m]!,
        b = results[m | (1 << i)]!;
      if (a[t] !== b[t]) own = true;
      if (a.some((x, k) => k !== t && x !== b[k])) effect = true;
    }
    if (effect) gen.push(name);
    if (!own) def.push(name);
  });
  return { exit, gen, def };
}
