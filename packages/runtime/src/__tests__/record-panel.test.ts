// 16:9 で法廷記録を開いたときの、右の欄のボタン（切り替え・つきつける・調べる・もどる）のテスト
import { type CompiledScenario, Engine } from '@gyakusai/core';
import { describe, expect, it } from 'vitest';
import { Backlog } from '../backlog.ts';
import { DEFAULT_LABELS } from '../options.ts';
import { panelButtons } from '../panel.ts';
import type { PlayerHost } from '../player-host.ts';
import { CourtRecord } from '../record.ts';

const scenario: CompiledScenario = {
  id: 't',
  title: 't',
  player: null,
  maxLife: 5,
  parts: [],
  characters: { a: { name: 'A' } },
  evidence: { box: { name: '箱', description: '' } },
  flags: {},
  startScene: 's',
  startEvidence: ['box'],
  startProfiles: null,
  gameoverScene: null,
  autoPause: false,
  autoShow: false,
  scenes: {
    s: {
      kind: 'dialogue',
      id: 's',
      program: [{ op: 'say', speaker: 'a', text: 'あ', color: 'white' }, { op: 'end' }],
    },
  },
};

function setup() {
  const engine = new Engine(scenario);
  const record = new CourtRecord();
  record.wide = true;
  record.show(engine, 'evidence');
  const host = { engine, record, labels: DEFAULT_LABELS } as unknown as PlayerHost;
  return { engine, record, host };
}

describe('16:9 の法廷記録のボタン', () => {
  it('つきつけない場面では、切り替えのタブ（0 段目）ともどる（4 段目）だけ', () => {
    const { host } = setup();
    const buttons = panelButtons(host, () => {});
    expect(buttons.map((b) => [b.slot, b.label])).toEqual([
      [0, DEFAULT_LABELS.profileTab],
      [4, DEFAULT_LABELS.back],
    ]);
  });

  it('タブで人物ファイルに切り替わり、ラベルは証拠品に変わる', () => {
    const { host, record } = setup();
    panelButtons(host, () => {})[0]?.run();
    expect(record.tab).toBe('profile');
    expect(panelButtons(host, () => {})[0]?.label).toBe(DEFAULT_LABELS.evidenceTab);
  });

  it('もどるは、詳細なら一覧に、一覧なら閉じる', () => {
    const { host, record } = setup();
    record.detail = true;
    panelButtons(host, () => {})
      .find((b) => b.slot === 4)
      ?.run();
    expect(record.detail).toBe(false);
    expect(record.open).toBe(true);
    panelButtons(host, () => {})
      .find((b) => b.slot === 4)
      ?.run();
    expect(record.open).toBe(false);
  });

  it('画面の中のボタンの位置をクリックしても効かない', () => {
    const { engine, record } = setup();
    record.click(engine, 20, 176);
    expect(record.open).toBe(true);
  });
});

describe('16:9 のバックログのボタン', () => {
  it('法廷記録のすぐ下に置き、進むは2〜4段目にする', () => {
    const { host, engine, record } = setup();
    record.open = false;
    const backlog = new Backlog();
    Object.assign(host, { backlog, beat: engine.beat, tw: null });
    const buttons = panelButtons(host, () => {});
    expect(buttons.find((b) => b.label === DEFAULT_LABELS.backlog)?.slot).toBe(1);
    expect(buttons.find((b) => b.arrow === 'right')?.slot).toEqual([2, 4]);
    buttons.find((b) => b.label === DEFAULT_LABELS.backlog)?.run();
    expect(backlog.open).toBe(true);
    expect(panelButtons(host, () => {}).map((b) => b.arrow)).toEqual(['up', 'down', undefined]);
  });
});
