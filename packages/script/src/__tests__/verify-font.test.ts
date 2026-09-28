// DS 版フォントに無い文字の検証（--check-font）のテスト
import { describe, expect, it } from 'vitest';
import { loadScenario } from '../load.ts';

const HEAD = `id: t
title: t
characters:
  me: { name: 私 }
evidence:
  a: { name: A, description: "" }
start: { scene: s }
scenes:
  s:
`;

const scenario = (line: string) => HEAD + `    - me: ${line}\n    - end: true\n`;

describe('フォントの文字チェック', () => {
  it('checkFont を渡さなければ何もチェックしない（既定）', () => {
    expect(loadScenario(scenario('俺はやってない')).diagnostics).toEqual([]);
  });

  it('フォントに無い漢字を、言い換え候補つきで報告する', () => {
    const ds = loadScenario(scenario('俺はやってない'), {
      checkFont: true,
    }).diagnostics;
    expect(ds).toHaveLength(1);
    expect(ds[0]!.severity).toBe('error');
    expect(ds[0]!.message).toContain('文字「俺」');
    expect(ds[0]!.message).toContain('オレ');
  });

  it('言い換え候補が無い文字は、候補なしと報告する', () => {
    const ds = loadScenario(scenario('これは龘という字だ'), {
      checkFont: true,
    }).diagnostics;
    expect(ds).toHaveLength(1);
    expect(ds[0]!.message).toContain('文字「龘」');
    expect(ds[0]!.message).toContain('対応する候補なし');
  });

  it('フォントにある漢字だけの台詞は診断なし', () => {
    expect(loadScenario(scenario('今日は良い天気だ'), { checkFont: true }).diagnostics).toEqual([]);
  });

  it('同じ文字が複数回出ても診断は1件にまとめる', () => {
    expect(loadScenario(scenario('俺も俺も俺だ'), { checkFont: true }).diagnostics).toHaveLength(1);
  });

  it('ID・条件式（_ や ==）や複数行の台詞、{flag} の差し込みは対象にしない', () => {
    const yaml = `id: t
title: t
characters:
  me: { name: 私 }
evidence:
  a: { name: A, description: "" }
flags: { bell_pressed: 0 }
start: { scene: s }
scenes:
  s:
    - me: |-
        今日は良い天気だ。
        また明日。
    - if: bell_pressed == 0
      then:
        - me: "「{bell_pressed}」を確かめた"
        - goto: s
    - end: true
`;
    expect(loadScenario(yaml, { checkFont: true }).diagnostics).toEqual([]);
  });
});
