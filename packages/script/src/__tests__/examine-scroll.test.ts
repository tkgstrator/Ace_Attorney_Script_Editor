// 横長の背景の場所: 調べる範囲は背景の座標、背景のスクロールの可否（examineScroll）、整合性チェックの試す点のテスト
import { type Beat, Engine, examineSpots } from '@gyakusai/core';
import { describe, expect, it } from 'vitest';
import { loadScenario } from '../load.ts';
import { verifyScenario } from '../verify.ts';

function load(yaml: string) {
  const { scenario, diagnostics } = loadScenario(yaml);
  if (!scenario)
    throw new Error(diagnostics.map((d) => `${d.line}:${d.column} ${d.message}`).join('\n'));
  return scenario;
}

function skip(e: Engine): Beat {
  for (let i = 0; i < 1000; i++) {
    const b = e.beat;
    if (b.kind !== 'line' && b.kind !== 'shout') return b;
    e.advance();
  }
  throw new Error('止まりません');
}

/** 横長（512 ドット）の背景の場所。右半分にだけ、話を進める所がある */
const chapter = (extra = '') => `
id: ch
title: 第1話
player: me
characters:
  me: { name: 私 }
evidence: {}
flags:
  locked: false
start: { scene: intro }
parts:
  - id: inv
    kind: investigation
    title: 探偵パート
    scenes:
      intro:
        - investigate: hall
      done:
        - me: 終わり。
        - end: true
    places:
      hall:
        name: 廊下
        background: wide
${extra}
        examine:
          - id: door
            area: [400, 40, 60, 100]
            then:
              - me: 扉だ。
              - goto: done
          - id: vase
            area: [20, 60, 30, 40]
            then:
              - me: 花瓶だ。
`;

describe('横長の背景の場所', () => {
  it('範囲は背景の座標のまま（画面の幅を超えてよい）で、その点を調べると当たる', () => {
    const sc = load(chapter());
    const e = new Engine(sc);
    skip(e);
    const door = examineSpots(sc, e.state).find((s) => s.id === 'door')!;
    expect(door.area).toEqual([400, 40, 60, 100]);
    expect(door.point).toEqual([430, 90]);
    e.examine(430, 90);
    expect(e.state.seen).toContain('door');
  });

  it('範囲が左・上の端より外か大きさ 0 ならエラー', () => {
    const { scenario, diagnostics } = loadScenario(
      chapter().replace('[20, 60, 30, 40]', '[-4, 60, 30, 40]'),
    );
    expect(scenario).toBeNull();
    expect(diagnostics.some((d) => d.message.includes('範囲'))).toBe(true);
  });

  it('examineScroll: 省略すると true、false や条件式なら、その値が探偵メニューの Beat に出る', () => {
    const on = new Engine(load(chapter()));
    expect(skip(on)).toMatchObject({ kind: 'investigate', examineScroll: true });
    const off = new Engine(load(chapter('        examineScroll: false')));
    expect(skip(off)).toMatchObject({ kind: 'investigate', examineScroll: false });
    const cond = new Engine(load(chapter('        examineScroll: not locked')));
    expect(skip(cond)).toMatchObject({ kind: 'investigate', examineScroll: true });
    cond.setFlag('locked', true);
    expect(cond.beat).toMatchObject({ kind: 'investigate', examineScroll: false });
  });

  it('整合性チェックは、画面の幅より右の範囲も試す（詰みにならない）', () => {
    const r = verifyScenario(load(chapter()));
    expect(r.findings.filter((f) => f.severity === 'error')).toEqual([]);
    expect(r.findings.some((f) => f.message.startsWith('詰み'))).toBe(false);
  });
});
