import { describe, expect, it } from 'vitest';
import {
  chunkRanges,
  foldLabel,
  foldUnits,
  type StepGroup,
  stepGroup,
  visibleRows,
} from '../step-groups.ts';
import { COMMAND_NAMES, stepTemplate } from '../steps.ts';

const ctx = { characters: ['a'], evidence: ['e'], scenes: ['s'], places: ['p'], flags: ['f'] };

describe('ステップの分け方', () => {
  it('種類ごとに分かれる', () => {
    expect(stepGroup({ naruse: 'はい' })).toBe('dialogue');
    expect(stepGroup({ narrate: 'x' })).toBe('dialogue');
    // biome-ignore lint/suspicious/noThenProperty: シナリオの形
    expect(stepGroup({ if: 'f', then: [] })).toBe('branch');
    expect(stepGroup({ bgm: 'x' })).toBe('effect');
    expect(stepGroup({ set: { f: true } })).toBe('state');
    expect(stepGroup({ goto: 's' })).toBe('flow');
    expect(stepGroup({ wait: 10 })).toBe('flow');
  });

  it('不明なステップと元の命令は、いつも見せる（null）', () => {
    expect(stepGroup({ text: 'x' })).toBeNull();
    expect(stepGroup({ native: 'x', args: [] })).toBeNull();
  });

  it('native のほかのすべてのコマンドに分け方がある', () => {
    for (const name of COMMAND_NAMES) {
      if (name === 'native') continue;
      expect(stepGroup(stepTemplate(name, ctx)), name).not.toBeNull();
    }
  });
});

describe('隠した行のまとめ', () => {
  const steps = [
    { a: '1' },
    { bgm: 'x' },
    { se: 'y' },
    { set: { f: 1 } },
    { a: '2' },
    { bgm: 'z' },
  ];
  const keys = steps.map((_, i) => `k${i}`);
  const hidden = new Set<StepGroup>(['effect', 'state']);

  it('隠す種類の行が false になる。開いた行は見せる', () => {
    expect(visibleRows(steps, keys, hidden, new Set())).toEqual([
      true,
      false,
      false,
      false,
      true,
      false,
    ]);
    expect(visibleRows(steps, keys, hidden, new Set(['k2']))[2]).toBe(true);
    expect(visibleRows(steps, keys, new Set(), new Set()).every(Boolean)).toBe(true);
  });

  it('連続する隠れた行を 1 つにまとめる（位置は元の列のまま）', () => {
    const vis = visibleRows(steps, keys, hidden, new Set());
    expect(foldUnits(vis)).toEqual([{ row: 0 }, { fold: [1, 3] }, { row: 4 }, { fold: [5, 5] }]);
    expect(foldUnits(vis.slice(2), 2)).toEqual([{ fold: [2, 3] }, { row: 4 }, { fold: [5, 5] }]);
  });

  it('まとまりは、隠れた行の連続の途中で切らない', () => {
    const vis = [true, false, false, false, true, true, false];
    expect(chunkRanges(vis, 2)).toEqual([
      [0, 4],
      [4, 6],
      [6, 7],
    ]);
    expect(chunkRanges([true, true, true], 40)).toEqual([[0, 3]]);
    expect(chunkRanges([], 40)).toEqual([]);
  });

  it('まとめた行の中身を数える', () => {
    expect(foldLabel(steps.slice(1, 4))).toBe('演出 2・状態 1');
  });
});
