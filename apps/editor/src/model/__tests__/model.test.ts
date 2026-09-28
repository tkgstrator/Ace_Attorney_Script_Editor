import { describe, expect, it } from 'vitest';
import { createHistory, push, redo, undo } from '../history.ts';
import { listParts, selectionForNode, selectionFromPath, uniqueId } from '../paths.ts';
import { makeSay, presentKeyOptions, profileIds, readSay, stepKind } from '../steps.ts';
import { addPartOps, renamePlaceOps } from '../structure.ts';
import { applyOps } from '../doc-session.ts';
import { toData } from '../yaml-doc.ts';

describe('steps', () => {
  it('ステップの種類を判定できる（省略形の台詞を含む）', () => {
    expect(stepKind({ naruse: 'はい' })).toBe('shorthand');
    expect(stepKind({ say: null, text: 'x' })).toBe('say');
    expect(stepKind({ if: 'a', then: [] })).toBe('if');
    expect(stepKind({ text: 'x' })).toBe('unknown');
    expect(stepKind('x')).toBe('unknown');
  });

  it('台詞は色の指定がなければ省略形になる', () => {
    expect(makeSay({ speaker: 'naruse', text: 'a' })).toEqual({ naruse: 'a' });
    expect(makeSay({ speaker: 'naruse', text: 'a', color: 'blue' })).toEqual({
      say: 'naruse',
      text: 'a',
      color: 'blue',
    });
    expect(makeSay({ speaker: null, text: 'a' })).toEqual({ say: null, text: 'a' });
    expect(readSay({ torii: 'b' })).toEqual({ speaker: 'torii', text: 'b' });
  });
});

describe('つきつけの表のキー', () => {
  it('人物ファイルを認める表では、profile のある人物も選べる（証拠品と同じ ID の人物・すでにあるキーは除く）', () => {
    const characters = {
      naruse: { name: '成瀬' },
      tomoe: { name: '巴', profile: { description: '検事' } },
      knife: { profile: { description: '' } },
    };
    expect(profileIds(characters)).toEqual(['tomoe', 'knife']);
    expect(presentKeyOptions(['knife', 'photo'], profileIds(characters), true, ['photo'])).toEqual([
      { id: 'knife', kind: 'evidence' },
      { id: 'tomoe', kind: 'profile' },
    ]);
    expect(presentKeyOptions(['knife'], profileIds(characters), false)).toEqual([
      { id: 'knife', kind: 'evidence' },
    ]);
    // 人物 ID の profiles は、台詞の省略形の人物 ID にならない
    expect(stepKind({ profiles: 'x' })).toBe('unknown');
  });
});

describe('paths', () => {
  const data = toData(`
id: a
scenes: { s0: [] }
parts:
  - { id: inv, kind: investigation, title: 探索, places: { lobby: { name: ロビー } }, scenes: { s1: [] } }
  - { id: tri, kind: trial, title: 裁判, scenes: { s2: [], s3: [] } }
`).data;

  it('古い形式の scenes と parts を並べて一覧にする', () => {
    expect(listParts(data).map((p) => [p.index, p.kind, p.scenes, p.places])).toEqual([
      [null, 'trial', ['s0'], []],
      [0, 'investigation', ['s1'], ['lobby']],
      [1, 'trial', ['s2', 's3'], []],
    ]);
  });

  it('診断のパスから開く項目を決める', () => {
    expect(selectionFromPath(['parts', 1, 'scenes', 's2', 3, 'text'])?.selection).toEqual({
      kind: 'scene',
      part: 1,
      id: 's2',
    });
    expect(selectionFromPath(['parts', 0, 'places', 'lobby', 'examine'])?.selection).toEqual({
      kind: 'place',
      part: 0,
      id: 'lobby',
    });
    expect(selectionFromPath(['scenes', 's0'])?.selection).toEqual({
      kind: 'scene',
      part: null,
      id: 's0',
    });
    expect(selectionFromPath(['start', 'scene'])?.selection).toEqual({ kind: 'meta' });
  });

  it('シーン・場所の ID から開く項目を決める', () => {
    expect(selectionForNode(data, 'lobby')).toEqual({ kind: 'place', part: 0, id: 'lobby' });
    expect(selectionForNode(data, 's3')).toEqual({ kind: 'scene', part: 1, id: 's3' });
    expect(selectionForNode(data, 's0')).toEqual({ kind: 'scene', part: null, id: 's0' });
    expect(selectionForNode(data, 'nope')).toBeNull();
  });

  it('重ならない ID を作る', () => {
    expect(uniqueId('scene', ['scene', 'scene_2'])).toBe('scene_3');
  });
});

describe('structure', () => {
  it('古い形式に編を足すと、先に scenes を裁判編に移す', () => {
    const src = 'id: a\nscenes:\n  s0:\n    - end: true\n';
    const { ops, index } = addPartOps(toData(src).data, 'investigation');
    const out = applyOps(src, ops);
    expect(index).toBe(1);
    expect(listParts(toData(out).data).map((p) => [p.index, p.id, p.kind])).toEqual([
      [0, 'trial', 'trial'],
      [1, 'investigation1', 'investigation'],
    ]);
  });

  it('場所の名前を変えると、移動先と investigate も書き換わる', () => {
    const src = `id: a
parts:
  - id: p
    kind: investigation
    title: 探索
    places:
      lobby: { name: ロビー, move: [office] }
      office: { name: 事務所, move: [{ to: lobby, when: x }] }
    scenes:
      s: [{ investigate: lobby }]
`;
    const out = applyOps(src, renamePlaceOps(toData(src).data, 0, 'lobby', 'hall'));
    expect(out).toContain('hall: { name: ロビー');
    expect(out).toContain('{ to: hall, when: x }');
    expect(out).toContain('{ investigate: hall }');
  });
});

describe('history', () => {
  it('続けての入力はまとめ、元に戻す・やり直すができる', () => {
    const merge = (a: string, b: string) => a + b;
    let h = createHistory<string>();
    h = push(h, 'a', 'k', 0, merge);
    h = push(h, 'b', 'k', 100, merge);
    h = push(h, 'c', 'other', 200, merge);
    h = push(h, 'd', 'other', 5000, merge);
    expect(h.past).toEqual(['ab', 'c', 'd']);
    const u = undo(h)!;
    expect(u.entry).toBe('d');
    const u2 = undo(u.history)!;
    expect(u2.entry).toBe('c');
    const r = redo(u2.history)!;
    expect(r.entry).toBe('c');
    expect(r.history.future).toEqual(['d']);
    expect(push(r.history, 'x').future).toEqual([]);
  });
});
