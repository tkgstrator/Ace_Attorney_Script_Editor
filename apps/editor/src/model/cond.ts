// 条件式（@gyakusai/core の expr.ts の小さな言語）の、エディタ側の道具。
// 構文に沿って ID を書き換える（文字列の中や、関数名・別の種類の ID は変えない）
import { ExprSyntaxError, exprRefs, parseExpr } from '@gyakusai/core';

/** 条件式の中の、書き換えたい ID の種類。var はフラグ（変数）、ほかは関数の引数 */
export type CondRef = 'var' | 'has' | 'visited' | 'seen';

interface Word {
  at: number;
  word: string;
}

/** 文字列の外にある識別子と、その直前・直後の記号 */
function words(src: string): (Word & { call: string | null; isCall: boolean })[] {
  const out: (Word & { call: string | null; isCall: boolean })[] = [];
  const re = /(["'])(?:(?!\1).)*\1?|[A-Za-z_][A-Za-z0-9_]*|\S/g;
  const toks: { at: number; t: string }[] = [];
  for (const m of src.matchAll(re)) toks.push({ at: m.index, t: m[0] });
  toks.forEach((tok, i) => {
    if (!/^[A-Za-z_]/.test(tok.t)) return;
    const next = toks[i + 1]?.t;
    const prev = toks[i - 1]?.t;
    const fn = toks[i - 2]?.t;
    out.push({
      at: tok.at,
      word: tok.t,
      // 直前が「関数名 (」なら、その関数の引数
      call: prev === '(' && fn && /^(has|visited|seen)$/.test(fn) ? fn : null,
      isCall: next === '(',
    });
  });
  return out;
}

const KEYWORDS = new Set(['and', 'or', 'not', 'true', 'false']);

/** 条件式の中の、kind の ID の出てくる位置 */
function positions(src: string, kind: CondRef, id: string): number[] {
  return words(src)
    .filter((w) => {
      if (w.word !== id || KEYWORDS.has(w.word)) return false;
      if (kind === 'var') return w.call === null && !w.isCall;
      return w.call === kind;
    })
    .map((w) => w.at);
}

/** 条件式に kind の ID が出てくるか */
export const condMentions = (src: string, kind: CondRef, id: string) =>
  positions(src, kind, id).length > 0;

/** 条件式の中の kind の ID を from から to に書き換える（ほかはそのまま） */
export function renameInCond(src: string, kind: CondRef, from: string, to: string): string {
  const at = positions(src, kind, from);
  let out = src;
  for (const p of at.reverse()) out = out.slice(0, p) + to + out.slice(p + from.length);
  return out;
}

export interface CondCheck {
  /** 構文エラー（なければ null） */
  error: string | null;
  /** 章にない ID（フラグ・証拠品など） */
  unknown: string[];
}

/** 条件式を調べる（構文と、知らない ID） */
export function checkCond(
  src: string,
  known: { flags: string[]; evidence: string[]; nodes: string[] },
): CondCheck {
  if (src.trim() === '') return { error: null, unknown: [] };
  try {
    const refs = exprRefs(parseExpr(src));
    const unknown = [
      ...refs.vars.filter((v) => !known.flags.includes(v)).map((v) => `フラグ ${v}`),
      ...refs.evidence.filter((v) => !known.evidence.includes(v)).map((v) => `証拠品 ${v}`),
      ...refs.scenes.filter((v) => !known.nodes.includes(v)).map((v) => `シーン・場所 ${v}`),
    ];
    return { error: null, unknown: [...new Set(unknown)] };
  } catch (e) {
    if (e instanceof ExprSyntaxError)
      return { error: `${e.message}（${e.column + 1} 文字目）`, unknown: [] };
    return { error: (e as Error).message, unknown: [] };
  }
}
