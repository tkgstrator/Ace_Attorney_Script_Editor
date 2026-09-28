// 遊んでいる途中の状態を、編集した後のシナリオに持ち込んで続けるテスト（エディタのプレビューの「再読み込み」）
import { Engine, mapPc, restoreEngine } from '@gyakusai/core';
import { describe, expect, it } from 'vitest';
import { loadScenario } from '../load.ts';

function load(yaml: string) {
  const { scenario, diagnostics } = loadScenario(yaml);
  if (!scenario)
    throw new Error(diagnostics.map((d) => `${d.line}:${d.column} ${d.message}`).join('\n'));
  return scenario;
}

const HEAD = `
id: t
title: テスト
player: me
characters:
  me: { name: 私 }
  w: { name: 証人 }
evidence:
  a: { name: 証拠A, description: "" }
  b: { name: 証拠B, description: "" }
flags: { met: false }
start: { scene: one, evidence: [a] }
`;

const ONE = `
scenes:
  one:
    - me: 一行目
    - set: { met: true }
    - give: b
    - if: met
      then:
        - me: 会った
    - me: 二行目
    - me: 三行目
    - end: true
  two:
    - w: 別のシーン
    - end: true
`;

/** 台詞 text まで進める */
function playTo(e: Engine, text: string) {
  for (let i = 0; i < 100; i++) {
    const b = e.beat;
    if (b.kind === 'line' && b.text === text) return e;
    e.advance();
  }
  throw new Error(`${text} に着きません`);
}

const restore = (e: Engine, yaml: string, opts?: { scene?: string }) =>
  restoreEngine(load(yaml), { scenario: e.scenario, state: e.state }, opts);

describe('restoreEngine', () => {
  it('同じ内容なら、同じ場面・同じ状態から', () => {
    const e = playTo(new Engine(load(HEAD + ONE)), '二行目');
    const r = restore(e, HEAD + ONE);
    expect(r.result).toBe('same');
    expect(r.engine.beat).toMatchObject({ kind: 'line', text: '二行目' });
    expect(r.engine.state.flags).toEqual({ met: true });
    expect(r.engine.state.evidence).toEqual(['a', 'b']);
  });

  it('前に行を足すと、ずらした位置から（分岐の飛び先がずれても）', () => {
    const e = playTo(new Engine(load(HEAD + ONE)), '二行目');
    const r = restore(
      e,
      HEAD + ONE.replace('    - me: 一行目\n', '    - me: 一行目\n    - me: 足した\n'),
    );
    expect(r.result).toBe('moved');
    expect(r.engine.beat).toMatchObject({ text: '二行目' });
    r.engine.advance();
    expect(r.engine.beat).toMatchObject({ text: '三行目' });
  });

  it('後ろを編集しても、同じ位置から', () => {
    const e = playTo(new Engine(load(HEAD + ONE)), '二行目');
    const r = restore(e, HEAD + ONE.replace('三行目', '三行目を直した'));
    expect(r.result).toBe('same');
    r.engine.advance();
    expect(r.engine.beat).toMatchObject({ text: '三行目を直した' });
  });

  it('今の台詞を編集したら、編集後の台詞から', () => {
    const e = playTo(new Engine(load(HEAD + ONE)), '二行目');
    const r = restore(e, HEAD + ONE.replace('二行目', '二行目を直した'));
    expect(r.result).toBe('moved');
    expect(r.engine.beat).toMatchObject({ text: '二行目を直した' });
    expect(r.engine.state.flags.met).toBe(true);
  });

  it('今の台詞を消したら、その後ろから', () => {
    const e = playTo(new Engine(load(HEAD + ONE)), '二行目');
    const r = restore(e, HEAD + ONE.replace('    - me: 二行目\n', ''));
    expect(r.result).toBe('moved');
    expect(r.engine.beat).toMatchObject({ text: '三行目' });
  });

  it('シーンが無くなったら最初から、知らせる', () => {
    const e = new Engine(load(HEAD + ONE));
    e.jumpTo('two');
    const r = restore(e, HEAD + ONE.replace(/ {2}two:[\s\S]*$/, ''));
    expect(r.result).toBe('start');
    expect(r.engine.beat).toMatchObject({ text: '一行目' });
    expect(r.notes.join()).toContain('two');
  });

  it('無くなった証拠品を外し、足されたフラグは初期値', () => {
    const e = playTo(new Engine(load(HEAD + ONE)), '三行目');
    const edited = (HEAD + ONE)
      .replace('  b: { name: 証拠B, description: "" }\n', '')
      .replace('    - give: b\n', '')
      .replace('flags: { met: false }', 'flags: { met: false, extra: 3 }');
    const r = restore(e, edited);
    expect(r.engine.beat).toMatchObject({ text: '三行目' });
    expect(r.engine.state.evidence).toEqual(['a']);
    expect(r.engine.state.flags).toEqual({ met: true, extra: 3 });
    expect(r.notes.join()).toContain('証拠品');
  });

  it('scene を指定すると、状態を保ったままそのシーンの始めから', () => {
    const e = playTo(new Engine(load(HEAD + ONE)), '三行目');
    const r = restore(e, HEAD + ONE, { scene: 'two' });
    expect(r.result).toBe('sceneStart');
    expect(r.engine.beat).toMatchObject({ text: '別のシーン' });
    expect(r.engine.state.flags.met).toBe(true);
    expect(r.engine.state.evidence).toEqual(['a', 'b']);
  });

  const TESTIMONY = `
scenes:
  one:
    testimony: 証言
    witness: w
    statements:
      - id: s1
        text: 証言1
      - id: s2
        text: 証言2
        press: [ { me: ゆさぶり }, { w: 答え } ]
    wrong: [ { w: 違います } ]
`;

  it('尋問の途中: 前に証言を足しても、同じ証言から', () => {
    const e = new Engine(load(HEAD + TESTIMONY));
    for (let i = 0; i < 6 && !(e.beat.kind === 'statement' && e.beat.cross); i++) e.advance();
    e.advance(); // 証言2
    expect(e.beat).toMatchObject({ kind: 'statement', cross: true, text: '証言2' });
    const r = restore(
      e,
      HEAD +
        TESTIMONY.replace('      - id: s2', '      - id: s0\n        text: 足した\n      - id: s2'),
    );
    expect(r.engine.beat).toMatchObject({ kind: 'statement', cross: true, text: '証言2' });
    // ゆさぶりのブロックの途中でも
    e.press();
    playTo(e, '答え');
    const r2 = restore(e, HEAD + TESTIMONY.replace('答え', '直した答え'));
    expect(r2.engine.beat).toMatchObject({ text: '直した答え' });
    // ゆさぶりの後は、編集前と同じく次の証言（最後の証言なので先頭）へ
    r2.engine.advance();
    expect(r2.engine.beat).toMatchObject({ kind: 'statement', text: '証言1' });
  });

  it('探偵メニュー: そのまま。scene に場所を指定すると探偵メニューから', () => {
    const yaml = `${HEAD}
parts:
  - id: inv
    kind: investigation
    title: 探偵
    scenes:
      one:
        - me: 来た
        - investigate: office
    places:
      office:
        name: 事務所
        examine:
          - area: [0, 0, 256, 192]
            then: [ { me: 机 } ]
`;
    const e = new Engine(load(yaml));
    e.advance();
    expect(e.beat).toMatchObject({ kind: 'investigate', place: 'office' });
    expect(restore(e, yaml.replace('机', '椅子')).engine.beat).toMatchObject({
      kind: 'investigate',
      place: 'office',
    });
    const r = restoreEngine(
      load(yaml),
      { scenario: e.scenario, state: e.state },
      { scene: 'office' },
    );
    expect(r.engine.beat).toMatchObject({ kind: 'investigate', place: 'office' });
  });
});

describe('restoreEngine: 詳しく調べている途中', () => {
  const INSPECT = `
id: t
title: テスト
characters:
  me: { name: 私 }
evidence:
  phone:
    name: 携帯電話
    description: ""
    examine:
      - spot: 裏
        then:
          - me: シールが貼ってある。
start: { scene: one, evidence: [phone] }
scenes:
  one:
    - me: 一行目
    - me: 二行目
    - end: true
`;

  it('調べ始めた台詞の位置もずらし、調べ終えたらそこへ戻る', () => {
    const e = playTo(new Engine(load(INSPECT)), '二行目');
    e.inspect('phone');
    expect(e.beat.kind).toBe('choice');
    const r = restore(
      e,
      INSPECT.replace('    - me: 一行目\n', '    - me: 一行目\n    - me: 足した\n'),
    );
    expect(r.result).toBe('moved');
    expect(r.engine.beat.kind).toBe('choice');
    r.engine.choose(0);
    expect(r.engine.beat).toMatchObject({ text: 'シールが貼ってある。' });
    r.engine.advance();
    expect(r.engine.beat).toMatchObject({ text: '二行目' });
  });

  it('調べ始めたシーンが無くなったら、最初から', () => {
    const e = playTo(new Engine(load(INSPECT)), '二行目');
    e.inspect('phone');
    const r = restore(e, INSPECT.replace('  one:', '  two:').replace('scene: one', 'scene: two'));
    expect(r.result).toBe('start');
    expect(r.engine.beat).toMatchObject({ text: '一行目' });
  });
});

describe('mapPc', () => {
  it('変わった所より前はそのまま、後ろはずらす', () => {
    const say = (text: string) => ({
      op: 'say' as const,
      speaker: null,
      text,
      color: 'white' as const,
    });
    const prev = [say('a'), say('b'), say('c'), { op: 'end' as const }];
    const next = [say('a'), say('x'), say('y'), say('c'), { op: 'end' as const }];
    expect(mapPc(prev, next, 0)).toEqual({ pc: 0, how: 'same' });
    expect(mapPc(prev, next, 1)).toEqual({ pc: 1, how: 'edited' });
    expect(mapPc(prev, next, 2)).toEqual({ pc: 3, how: 'shifted' });
    expect(mapPc(prev, next, 9)).toBeNull();
  });
});
