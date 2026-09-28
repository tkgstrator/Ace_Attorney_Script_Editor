// 人物ファイルをつきつける（探偵パートの present・つきつけの要求）のテスト
import { Engine, heldProfiles, type Beat } from '@gyakusai/core';
import { describe, expect, it } from 'vitest';
import { loadScenario } from '../load.ts';
import { verifyScenario } from '../verify.ts';

function load(yaml: string) {
  const { scenario, diagnostics } = loadScenario(yaml);
  if (!scenario)
    throw new Error(diagnostics.map((d) => `${d.line}:${d.column} ${d.message}`).join('\n'));
  return scenario;
}

/** 台詞・吹き出しを読み飛ばし、止まった Beat と通過した台詞を返す */
function skip(e: Engine): { beat: Beat; lines: string[] } {
  const lines: string[] = [];
  for (let i = 0; i < 1000; i++) {
    const b = e.beat;
    if (b.kind !== 'line' && b.kind !== 'shout') return { beat: b, lines };
    if (b.kind === 'line') lines.push(b.text);
    e.advance();
  }
  throw new Error('止まりません');
}

const CHAPTER = `
id: ch
title: 人物ファイル
player: me
characters:
  me: { name: 私 }
  tomoe: { name: 巴, profile: { name: 宝月 巴, description: 主席検事 } }
  ema: { name: 茜, profile: { description: 妹 } }
  judge: { name: 裁判長 }
evidence:
  badge: { name: バッジ, description: "" }
flags:
  asked: false
start: { scene: intro, evidence: [badge], profiles: [tomoe] }
parts:
  - id: inv
    kind: investigation
    title: 探偵パート
    scenes:
      intro:
        - investigate: jail
    places:
      jail:
        name: 留置所
        person: tomoe
        talk:
          - topic: 妹
            then:
              - giveProfile: ema
              - tomoe: 茜のことです。
        present:
          ema:
            - tomoe: 妹です。
            - set: { asked: true }
          badge:
            - tomoe: キレイですね。
        presentWrong:
          - tomoe: 「{evidence}」がどうかしましたか。
        move: [court_gate]
      court_gate:
        name: 法廷の前
        move: [jail]
  - id: court
    kind: trial
    title: 法廷
    scenes:
      trial:
        - demand: 電話の持ち主は？
          present:
            tomoe:
              - judge: そのとおり。
          wrong:
            - judge: 違います。
        - demand: 証拠品を
          profiles: true
          present:
            badge:
              - end: true
          wrong:
            - judge: 違う。
`;

describe('人物ファイルをつきつける', () => {
  it('探偵パートでは人物ファイルもつきつけられ、表に無い人物は既定の反応（名前は人物ファイルの表示名）', () => {
    const e = new Engine(load(CHAPTER));
    expect(e.canPresent).toBe(true);
    expect(e.canPresentProfile).toBe(true);
    e.present('tomoe', 'profile');
    expect(skip(e).lines).toEqual(['「宝月 巴」がどうかしましたか。']);
    expect(e.beat.kind).toBe('investigate');
    // 持っていない人物ファイルはつきつけられない。話して人物ファイルに加えると、表の反応
    expect(() => e.present('ema', 'profile')).toThrow(/人物ファイルに載っていない/);
    e.talk('jail_talk1');
    skip(e);
    expect(heldProfiles(e.scenario, e.state)).toEqual(['tomoe', 'ema']);
    e.present('ema');
    expect(skip(e).lines).toEqual(['妹です。']);
    expect(e.state.flags.asked).toBe(true);
  });

  it('つきつけの要求: 人物 ID が正解なら人物ファイルもつきつけられ、profiles: true なら正解が証拠品だけでも', () => {
    const sc = load(CHAPTER);
    const e = new Engine(sc);
    e.jumpTo('trial');
    const b = e.beat;
    expect(b.kind === 'demand' && b.profiles).toBe(true);
    e.present('badge');
    expect(skip(e).lines).toEqual(['違います。']);
    e.present('tomoe', 'profile');
    expect(skip(e).lines).toEqual(['そのとおり。']);
    // 2 つ目の要求（profiles: true）は、人物ファイルなら見当違い
    expect(e.canPresentProfile).toBe(true);
    e.present('tomoe', 'profile');
    expect(skip(e).lines).toEqual(['違う。']);
    e.present('badge');
    expect(skip(e).beat.kind).toBe('end');
  });

  it('人物ファイルを認めない要求・尋問では、人物ファイルはつきつけられない', () => {
    const e = new Engine(
      load(`
id: c
title: c
characters:
  w: { name: 証人, profile: { description: 目撃者 } }
evidence:
  a: { name: A, description: "" }
start: { scene: s, evidence: [a] }
scenes:
  s:
    - demand: 見せて
      present:
        a:
          - goto: t
  t:
    testimony: 証言
    witness: w
    statements:
      - text: 見ました。
        present:
          a:
            - end: true
`),
    );
    expect(e.canPresentProfile).toBe(false);
    expect(() => e.present('w', 'profile')).toThrow(/人物ファイルをつきつけられません/);
    e.present('a');
    for (let i = 0; i < 20 && !(e.beat.kind === 'statement' && e.beat.cross); i++) e.advance();
    expect(e.beat.kind === 'statement' && e.beat.cross).toBe(true);
    expect(() => e.present('w', 'profile')).toThrow(/尋問では/);
  });

  it('つきつけの表のキーの誤りを報告する', () => {
    const errors = (body: string) =>
      loadScenario(`
id: c
title: c
characters:
  w: { name: 証人, profile: { description: 目撃者 } }
  x: { name: 名前だけ }
  a: { name: 同じ ID }
evidence:
  a: { name: A, description: "" }
start: { scene: s }
scenes:
  s:
${body}
`)
        .diagnostics.filter((d) => d.severity === 'error')
        .map((d) => d.message);
    expect(errors('    - demand: 見せて\n      present: { zzz: [] }')).toEqual([
      '未定義の証拠品・人物です: zzz',
    ]);
    expect(errors('    - demand: 見せて\n      present: { x: [] }')[0]).toMatch(/profile が無い/);
    expect(errors('    - demand: 見せて\n      present: { a: [] }')[0]).toMatch(/両方の ID/);
    expect(
      errors('    - demand: 見せて\n      profiles: false\n      present: { w: [] }')[0],
    ).toMatch(/profiles: false/);
  });

  it('整合性チェック: 証拠品がすべて正解でも、人物ファイルで見当違いの反応に着ける', () => {
    const yaml = (profiles: string) => `
id: c
title: c
characters:
  me: { name: 私 }
  w: { name: 証人, profile: { description: 目撃者 } }
evidence:
  badge: { name: バッジ, description: "" }
start: { scene: s, evidence: [badge], profiles: [${profiles}] }
parts:
  - id: p
    kind: investigation
    title: 探偵
    scenes:
      s:
        - investigate: room
      other:
        - me: 見当違いだった。
        - end: true
    places:
      room:
        name: 部屋
        person: w
        present:
          badge:
            - end: true
        presentWrong:
          - goto: other
`;
    const unreachable = (y: string) =>
      verifyScenario(load(y)).findings.filter((f) => f.message.includes('other'));
    expect(unreachable(yaml('w'))).toEqual([]);
    // 人物ファイルが無ければ、見当違いの反応には着けない
    expect(unreachable(yaml('')).length).toBe(1);
  });
});
