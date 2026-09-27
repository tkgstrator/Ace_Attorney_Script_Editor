import { describe, expect, it } from 'vitest';
import { evalExpr, exprRefs, parseExpr, ExprSyntaxError, type ExprEnv } from './expr.ts';

const env = (flags: Record<string, boolean | number | string>, evidence: string[] = []): ExprEnv => ({
  variable: n => flags[n]!,
  has: id => evidence.includes(id),
  visited: () => false,
  seen: () => false,
});
const run = (src: string, e: ExprEnv) => evalExpr(parseExpr(src), e);

describe('expr', () => {
  it('論理演算は記号でも英単語でも書ける', () => {
    const e = env({ a: true, b: false });
    expect(run('a && !b', e)).toBe(true);
    expect(run('a and not b', e)).toBe(true);
    expect(run('b or a', e)).toBe(true);
    expect(run('not (a or b)', e)).toBe(false);
  });

  it('比較と加算、優先順位', () => {
    const e = env({ n: 3, name: 'x' });
    expect(run('n + 1 == 4', e)).toBe(true);
    expect(run('n >= 3 and n < 5', e)).toBe(true);
    expect(run('name == "x"', e)).toBe(true);
    expect(run('-n', e)).toBe(-3);
  });

  it('has() は所持している証拠品を調べる', () => {
    expect(run('has(knife) and not has(gun)', env({}, ['knife']))).toBe(true);
  });

  it('参照を集められる', () => {
    expect(exprRefs(parseExpr('a and has(k) or visited(s1) and b or seen(t1)'))).toEqual({ vars: ['a', 'b'], evidence: ['k'], scenes: ['s1'], seen: ['t1'] });
  });

  it('構文エラーは位置付きで投げる', () => {
    expect(() => parseExpr('a ==')).toThrow(ExprSyntaxError);
    expect(() => parseExpr('a b')).toThrow(/余分/);
    expect(() => parseExpr('foo(x)')).toThrow(/未知の関数/);
    try { parseExpr('a && #'); } catch (e) { expect((e as ExprSyntaxError).column).toBe(5); }
  });
});
