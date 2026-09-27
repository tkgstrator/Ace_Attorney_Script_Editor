// 整合性チェックの下調べ（式が本当に読む変数・if のかたまりのまとめ）のテスト
import { parseExpr, type Instr } from '@gyakusai/core';
import { describe, expect, it } from 'vitest';
import { exprDeps, summarize } from './verify-region.ts';

const bool = new Set(['a', 'b', 'c', 'd', 'first']);

describe('式が本当に読む変数', () => {
  it('値によらない変数は読まないとみなす', () => {
    expect(exprDeps(parseExpr('(not a and b) or (not a and not b)'), bool)).toEqual(['a']);
    expect(exprDeps(parseExpr('((not a and b) or (c and d) or (c and not d)) and first'), bool).sort()).toEqual(['a', 'b', 'c', 'first']);
  });

  it('真偽でない変数を含む式は、出てくる変数をすべて読むとみなす', () => {
    expect(exprDeps(parseExpr('count == 2 or (b or not b)'), bool).sort()).toEqual(['b', 'count']);
  });

  it('証拠品（has）は変数に含めないが、式の値は証拠品の有無も考えて調べる', () => {
    expect(exprDeps(parseExpr('has(key) and a'), bool)).toEqual(['a']);
    expect(exprDeps(parseExpr('visited(x) or seen(y)'), bool).sort()).toEqual(['s:y', 'v:x']);
  });
});

describe('if のかたまりのまとめ', () => {
  const say: Instr = { op: 'say', speaker: null, text: '…', color: 'white' };

  it('初回だけフラグを立てるかたまりは、出口ではフラグが必ず立っているので、書き込みとみなす', () => {
    // 0: if not first → 1〜3 / 4: 出口（menu）
    const program: Instr[] = [
      { op: 'jumpUnless', cond: parseExpr('not first'), to: 4 },
      { op: 'set', flag: 'first', value: true },
      say,
      { op: 'set', flag: 'person', value: 3 },
      { op: 'menu' },
    ];
    const s = summarize(program, 0, bool)!;
    expect(s.exit).toBe(4);
    // first は person を書くかどうかに効くので読む。出口では必ず真なので、書き込みでもある
    expect(s.gen).toEqual(['first']);
    expect(s.def).toEqual(['first']);
  });

  it('どちらの道でも同じ値を書くなら、条件の変数は読まない', () => {
    // if a then [set person 0] else [台詞; set person 0; set a true]
    const program: Instr[] = [
      { op: 'jumpUnless', cond: parseExpr('a'), to: 3 },
      { op: 'set', flag: 'person', value: 0 },
      { op: 'jump', to: 6 },
      say,
      { op: 'set', flag: 'person', value: 0 },
      { op: 'set', flag: 'a', value: true },
      { op: 'menu' },
    ];
    const s = summarize(program, 0, bool)!;
    expect(s.exit).toBe(6);
    expect(s.gen).toEqual([]);
    expect(s.def.sort()).toEqual(['a', 'person']);
  });

  it('表示だけを変える条件の変数は、読まないが書き込みもしない（出口の先で読むなら生きたまま）', () => {
    const program: Instr[] = [
      { op: 'jumpUnless', cond: parseExpr('b'), to: 3 },
      say,
      { op: 'jump', to: 4 },
      say,
      { op: 'goto', scene: 'next' },
    ];
    const s = summarize(program, 0, bool)!;
    expect(s).toEqual({ exit: 4, gen: [], def: [] });
  });

  it('道によって出口が違う・選ぶ場面がある・真偽でない変数を読むときは、まとめない', () => {
    const two: Instr[] = [
      { op: 'jumpUnless', cond: parseExpr('a'), to: 2 },
      { op: 'goto', scene: 'x' },
      { op: 'goto', scene: 'y' },
    ];
    expect(summarize(two, 0, bool)).toBeNull();
    const numeric: Instr[] = [
      { op: 'jumpUnless', cond: parseExpr('count == 1'), to: 2 },
      say,
      { op: 'menu' },
    ];
    expect(summarize(numeric, 0, bool)).toBeNull();
  });
});
