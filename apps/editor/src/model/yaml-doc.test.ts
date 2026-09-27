import { describe, expect, it } from 'vitest';
import { applyOps } from './doc-session.ts';
import { toData } from './yaml-doc.ts';

const SRC = `# 先頭のコメント
id: case1
title: テスト

flags:
  asked: false   # 聞いたか
  count: 0       # 回数

start:
  scene: opening
  evidence: [badge, photo]

scenes:
  opening:
    - naruse: こんにちは
    - card: "9月27日\\n法廷"
    - goto: next
  next:
    - end: true
`;

describe('applyOps', () => {
  it('何もしなければ元のテキストのまま（コメントの位置揃えも）', () => {
    expect(applyOps(SRC, [])).toBe(SRC);
  });

  it('スカラーを書き換えても、引用符・コメント・キーの順番が残る', () => {
    const out = applyOps(SRC, [
      { op: 'set', path: ['scenes', 'opening', 1, 'card'], value: '9月28日\n法廷' },
      { op: 'set', path: ['flags', 'count'], value: 3 },
    ]);
    expect(out).toContain('- card: "9月28日\\n法廷"');
    expect(out).toContain('  count: 3 # 回数');
    expect(out).toContain('  asked: false   # 聞いたか');
    expect(out).toContain('# 先頭のコメント');
    expect(out.indexOf('flags:')).toBeLessThan(out.indexOf('start:'));
  });

  it('ステップを差し込み・並べ替え・削除できる', () => {
    let out = applyOps(SRC, [{ op: 'insert', path: ['scenes', 'opening'], index: 1, value: { set: { asked: true } } }]);
    expect(out).toContain('    - naruse: こんにちは\n    - set: { asked: true }\n');
    out = applyOps(out, [{ op: 'move', path: ['scenes', 'opening'], from: 0, to: 2 }]);
    const steps = (toData(out).data!.scenes as Record<string, unknown[]>).opening!;
    expect(steps.map(s => Object.keys(s as object)[0])).toEqual(['set', 'card', 'naruse', 'goto']);
    out = applyOps(out, [{ op: 'delete', path: ['scenes', 'opening', 0] }]);
    expect(out).not.toContain('set:');
  });

  it('キーの名前を変えても位置が変わらず、参照も書き換えられる', () => {
    const out = applyOps(SRC, [
      { op: 'renameKey', path: ['scenes'], from: 'next', to: 'finale' },
      { op: 'renameRefs', target: 'scene', from: 'next', to: 'finale' },
    ]);
    expect(out).toContain('  finale:\n    - end: true');
    expect(out).toContain('- goto: finale');
  });

  it('空のフロー形式の列に入れ物を足すと、ブロック形式になる', () => {
    const out = applyOps('id: a\nscenes:\n  s: []\n', [{ op: 'insert', path: ['scenes', 's'], value: { choice: [{ text: 'A' }] } }]);
    expect(out).toBe('id: a\nscenes:\n  s:\n    - choice:\n        - text: A\n');
  });

  it('値を別の場所に移すと、中のコメントも付いていく', () => {
    const out = applyOps(SRC, [
      { op: 'set', path: ['parts'], value: [{ id: 'trial', kind: 'trial', title: '裁判編' }] },
      { op: 'relocate', from: ['scenes'], to: ['parts', 0, 'scenes'] },
    ]);
    const data = toData(out).data!;
    expect(data.scenes).toBeUndefined();
    expect(Object.keys((data.parts as { scenes: object }[])[0]!.scenes)).toEqual(['opening', 'next']);
  });

  it('新しく書いた短い列は [a, b]、マップは { a: b } の形になる', () => {
    const out = applyOps('id: a\n', [{ op: 'set', path: ['x'], value: { area: [1, 2, 3, 4], set: { f: true } } }]);
    expect(out).toBe('id: a\nx:\n  area: [1, 2, 3, 4]\n  set: { f: true }\n');
  });

  it('構文エラーのあるテキストは編集できない', () => {
    expect(() => applyOps('a: [', [])).toThrow();
    expect(toData('a: [').error).not.toBeNull();
  });
});
