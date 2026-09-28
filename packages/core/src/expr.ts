// 条件式の小さな言語。シナリオの `if:` や `when:` に書く。
//
//   has(repair) and not bell_pressed
//   mistakes == 0 || life >= 5
//   visited(t1_cross)
//   seen(office_desk)   （探索編で調べた・話した印）
//
// YAML では行頭の `!` がタグとして解釈されるため、not / and / or も使えるようにしている。

import type { BinaryOp, Expr, Value } from './types.ts';

export class ExprSyntaxError extends Error {
  readonly column: number;
  constructor(message: string, column: number) {
    super(message);
    this.column = column;
  }
}

type Token =
  | { k: 'num'; v: number; at: number }
  | { k: 'str'; v: string; at: number }
  | { k: 'id'; v: string; at: number }
  | { k: 'op'; v: string; at: number }
  | { k: 'eof'; at: number };

const OPS = ['&&', '||', '==', '!=', '<=', '>=', '<', '>', '+', '-', '!', '(', ')', ','];
const WORD_OPS: Record<string, string> = { and: '&&', or: '||', not: '!' };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const at = i;
    if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i))!;
      out.push({ k: 'num', v: Number(m[0]), at });
      i += m[0].length;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new ExprSyntaxError('文字列が閉じられていません', at);
      out.push({ k: 'str', v: src.slice(i + 1, end), at });
      i = end + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      const w = m[0];
      if (w in WORD_OPS) out.push({ k: 'op', v: WORD_OPS[w]!, at });
      else out.push({ k: 'id', v: w, at });
      i += w.length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new ExprSyntaxError(`使えない文字です: ${c}`, at);
    out.push({ k: 'op', v: op, at });
    i += op.length;
  }
  out.push({ k: 'eof', at: src.length });
  return out;
}

export function parseExpr(src: string): Expr {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p]!;
  const isOp = (v: string) => {
    const t = peek();
    return t.k === 'op' && t.v === v;
  };
  const expectOp = (v: string) => {
    if (!isOp(v)) throw new ExprSyntaxError(`「${v}」が必要です`, peek().at);
    p++;
  };

  const binary = (ops: string[], next: () => Expr) => (): Expr => {
    let l = next();
    for (;;) {
      const t = peek();
      if (t.k !== 'op' || !ops.includes(t.v)) return l;
      p++;
      l = { t: 'bin', op: t.v as BinaryOp, l, r: next() };
    }
  };

  const primary = (): Expr => {
    const t = peek();
    if (t.k === 'num') {
      p++;
      return { t: 'lit', v: t.v };
    }
    if (t.k === 'str') {
      p++;
      return { t: 'lit', v: t.v };
    }
    if (t.k === 'id') {
      p++;
      if (t.v === 'true' || t.v === 'false') return { t: 'lit', v: t.v === 'true' };
      if (isOp('(')) {
        if (t.v !== 'has' && t.v !== 'visited' && t.v !== 'seen')
          throw new ExprSyntaxError(`未知の関数です: ${t.v}`, t.at);
        p++;
        const a = peek();
        if (a.k !== 'id') throw new ExprSyntaxError(`${t.v}() の中には ID を書いてください`, a.at);
        p++;
        expectOp(')');
        return { t: 'call', fn: t.v, arg: a.v };
      }
      return { t: 'var', name: t.v };
    }
    if (isOp('(')) {
      p++;
      const e = or();
      expectOp(')');
      return e;
    }
    if (isOp('!')) {
      p++;
      return { t: 'not', e: primary() };
    }
    if (isOp('-')) {
      p++;
      return { t: 'bin', op: '-', l: { t: 'lit', v: 0 }, r: primary() };
    }
    throw new ExprSyntaxError(
      t.k === 'eof' ? '式が途中で終わっています' : '式として読めません',
      t.at,
    );
  };
  const sum = binary(['+', '-'], primary);
  const cmp = binary(['==', '!=', '<', '<=', '>', '>='], sum);
  const and = binary(['&&'], cmp);
  const or = binary(['||'], and);

  const e = or();
  if (peek().k !== 'eof') throw new ExprSyntaxError('式の後ろに余分なものがあります', peek().at);
  return e;
}

/** 式が参照している変数名・証拠品・シーンを集める（検証用） */
export function exprRefs(
  e: Expr,
  out = {
    vars: [] as string[],
    evidence: [] as string[],
    scenes: [] as string[],
    seen: [] as string[],
  },
) {
  switch (e.t) {
    case 'var':
      out.vars.push(e.name);
      break;
    case 'call':
      ({ has: out.evidence, visited: out.scenes, seen: out.seen })[e.fn].push(e.arg);
      break;
    case 'not':
      exprRefs(e.e, out);
      break;
    case 'bin':
      exprRefs(e.l, out);
      exprRefs(e.r, out);
      break;
  }
  return out;
}

export interface ExprEnv {
  variable(name: string): Value;
  has(evidence: string): boolean;
  visited(scene: string): boolean;
  /** 調べた・話した印（探索編の examine・talk の ID） */
  seen(id: string): boolean;
}

export function evalExpr(e: Expr, env: ExprEnv): Value {
  switch (e.t) {
    case 'lit':
      return e.v;
    case 'var':
      return env.variable(e.name);
    case 'call':
      return env[e.fn](e.arg);
    case 'not':
      return !evalExpr(e.e, env);
    case 'bin': {
      if (e.op === '&&') return !!evalExpr(e.l, env) && !!evalExpr(e.r, env);
      if (e.op === '||') return !!evalExpr(e.l, env) || !!evalExpr(e.r, env);
      const l = evalExpr(e.l, env),
        r = evalExpr(e.r, env);
      switch (e.op) {
        case '==':
          return l === r;
        case '!=':
          return l !== r;
        case '<':
          return l < r;
        case '<=':
          return l <= r;
        case '>':
          return l > r;
        case '>=':
          return l >= r;
        case '+':
          return typeof l === 'number' && typeof r === 'number' ? l + r : String(l) + String(r);
        case '-':
          return Number(l) - Number(r);
      }
    }
  }
}
