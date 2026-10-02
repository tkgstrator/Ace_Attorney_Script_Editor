// 証拠品・人物ファイルの説明が、フラグで切り替わるテスト
import { Engine, evidenceDescription, profileDescription } from '@gyakusai/core';
import { describe, expect, it } from 'vitest';
import { loadScenario } from '../load.ts';

const CHAPTER = `
id: d
title: 説明の切り替え
characters:
  me: { name: 私 }
  kage:
    name: 影山
    profile:
      description:
        - { when: partner_known, text: 共犯者がいる。 }
        - { text: 舞台監督。 }
evidence:
  dye:
    name: 染料
    description:
      - when: dye_detail
        text: 詳しい説明。
      - text: 青く染める物。
flags:
  dye_detail: false
  partner_known: false
start: { scene: s, evidence: [dye] }
scenes:
  s:
    - me: はい。
    - set: { dye_detail: true, partner_known: true }
    - me: 更新した。
    - end: true
`;

describe('説明の切り替え', () => {
  it('フラグを set する前と後で、証拠品・人物ファイルの説明が変わる', () => {
    const { scenario, diagnostics } = loadScenario(CHAPTER);
    if (!scenario) throw new Error(diagnostics.map((d) => d.message).join('\n'));
    const e = new Engine(scenario);
    expect(evidenceDescription(scenario, e.state, 'dye')).toBe('青く染める物。');
    expect(profileDescription(scenario, e.state, 'kage')).toBe('舞台監督。');
    e.advance();
    e.advance();
    expect(evidenceDescription(scenario, e.state, 'dye')).toBe('詳しい説明。');
    expect(profileDescription(scenario, e.state, 'kage')).toBe('共犯者がいる。');
  });

  it('条件の未定義のフラグを報告し、説明の条件だけで読むフラグは未使用にならない', () => {
    const bad = loadScenario(CHAPTER.replace('when: dye_detail', 'when: nope'));
    expect(bad.diagnostics.some((d) => d.message.includes('未定義のフラグです: nope'))).toBe(true);
    const ok = loadScenario(
      CHAPTER.replace('dye_detail: true, partner_known: true', 'x: 1').replace(
        'x: 1',
        'dye_detail: true',
      ),
    );
    expect(ok.diagnostics.some((d) => d.message.includes('一度も参照されていません'))).toBe(false);
  });

  it('文字列の説明はそのまま', () => {
    const { scenario } = loadScenario(
      CHAPTER.replace(/description:\n {6}- when[\s\S]*?青く染める物。/, 'description: 単純'),
    );
    expect(scenario?.evidence.dye?.description).toBe('単純');
  });
});
