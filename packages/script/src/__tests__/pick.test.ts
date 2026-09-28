// pick（絵の上の範囲を選ぶ）のコンパイル・実行・目印・整合性チェックのテスト
import { type Beat, Engine, pickMarkers } from '@gyakusai/core';
import { describe, expect, it } from 'vitest';
import { loadScenario } from '../load.ts';
import { verifyScenario } from '../verify.ts';

function load(yaml: string) {
  const { scenario, diagnostics } = loadScenario(yaml);
  if (!scenario)
    throw new Error(diagnostics.map((d) => `${d.line}:${d.column} ${d.message}`).join('\n'));
  return scenario;
}

function errors(yaml: string): string[] {
  return loadScenario(yaml)
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => d.message);
}

/** 台詞を読み飛ばして、止まった Beat を返す */
function skip(e: Engine): Beat {
  for (let i = 0; i < 1000; i++) {
    const b = e.beat;
    if (b.kind !== 'line') return b;
    e.advance();
  }
  throw new Error('止まりません');
}

/** 台詞を読み飛ばしながら、出た台詞を集める */
function lines(e: Engine): string[] {
  const out: string[] = [];
  for (let i = 0; i < 1000; i++) {
    const b = e.beat;
    if (b.kind !== 'line') return out;
    out.push(b.text);
    e.advance();
  }
  throw new Error('止まりません');
}

const CHAPTER = `
id: ch
title: 第1話
player: me
characters:
  me: { name: 私 }
evidence: {}
flags:
  glove: false
start: { scene: intro }
parts:
  - id: p
    kind: trial
    title: 法廷
    scenes:
      intro:
        - pick: 指を選んでください。
          images: [hand, door]
          areas:
            - name: 指
              area: [10, 10, 20, 20]
              image: 0
              when: not glove
              then:
                - me: 手袋の跡だ。
                - set: { glove: true }
                - goto: intro
            - name: 扉の指紋
              area: [100, 50, 30, 30]
              image: 1
              when: glove
              then:
                - me: 指紋が出た。
            - name: どの絵でも
              area: [200, 150, 10, 10]
              then:
                - me: すみっこ。
          miss:
            - me: 何もない。
          quit:
            - me: やめた。
        - me: 次へ。
        - end: true
`;

describe('pick', () => {
  it('範囲・範囲の外・やめるを、この順の選べるものにする', () => {
    const sc = load(CHAPTER);
    const ins = sc.scenes.intro!.program[0]!;
    expect(ins.op).toBe('pick');
    if (ins.op !== 'pick') return;
    expect(ins.prompt).toBe('指を選んでください。');
    expect(ins.images).toEqual(['hand', 'door']);
    expect(ins.options.map((o) => o.kind)).toEqual(['area', 'area', 'area', 'miss', 'quit']);
    expect(ins.options[0]).toMatchObject({ area: [10, 10, 20, 20], image: 0, name: '指' });
    expect(ins.options[2]!.image).toBeUndefined();
  });

  it('Beat には今選べる範囲だけを出す', () => {
    const e = new Engine(load(CHAPTER));
    const b = skip(e);
    expect(b).toEqual({
      kind: 'pick',
      prompt: '指を選んでください。',
      images: ['hand', 'door'],
      areas: [
        { area: [10, 10, 20, 20], image: 0 },
        { area: [200, 150, 10, 10], image: null },
      ],
      miss: true,
      quit: true,
    });
  });

  it('当たった範囲の then を実行し、絵の番号も見る', () => {
    const e = new Engine(load(CHAPTER));
    skip(e);
    // 扉の絵（1）の上の同じ点は、指の範囲（絵 0）に当たらず範囲の外
    expect(e.pickAt(15, 15, 1)).toBe(true);
    expect(lines(e)).toEqual(['何もない。']);
    // 範囲の外の後は、もう一度選ぶ
    expect(e.beat.kind).toBe('pick');
    e.pickAt(15, 15, 0);
    expect(lines(e)).toEqual(['手袋の跡だ。']);
    // 条件で選べる範囲が替わる
    const b = e.beat as Extract<Beat, { kind: 'pick' }>;
    expect(b.areas.map((a) => a.area)).toEqual([
      [100, 50, 30, 30],
      [200, 150, 10, 10],
    ]);
    e.pickAt(110, 60, 1);
    expect(lines(e)).toEqual(['指紋が出た。', '次へ。']);
  });

  it('やめると quit の後、次のステップへ進む', () => {
    const e = new Engine(load(CHAPTER));
    skip(e);
    e.pickQuit();
    expect(lines(e)).toEqual(['やめた。', '次へ。']);
  });

  it('範囲の外を書かなければ、外は選べない（何もしない）', () => {
    const e = new Engine(load(CHAPTER.replace(/ {10}miss:\n {12}- me: 何もない。\n/, '')));
    skip(e);
    expect(e.pickAt(0, 0, 0)).toBe(false);
    expect(e.beat.kind).toBe('pick');
    expect(() => e.advance()).toThrow();
  });

  it('目印は、その絵の上の範囲だけ（手前に隠れた所は null）', () => {
    expect(
      pickMarkers(
        [
          { area: [0, 0, 50, 50], image: null },
          { area: [10, 10, 10, 10], image: 0 },
          { area: [100, 0, 10, 10], image: 1 },
        ],
        0,
      ),
    ).toEqual([[25, 25], null]);
  });

  it('無い絵の番号はエラー', () => {
    expect(errors(CHAPTER.replace('image: 1', 'image: 2'))).toEqual([
      expect.stringContaining('images に 2 番の絵がありません'),
    ]);
  });

  it('整合性チェック: 範囲を選ぶ操作をすべて試す', () => {
    const r = verifyScenario(load(CHAPTER));
    expect(r.findings.filter((f) => f.severity === 'error')).toEqual([]);
    // 選べない範囲があって先へ進めないと詰み
    const stuck = verifyScenario(
      load(
        CHAPTER.replace('when: glove', 'when: glove and false')
          .replace(/ {12}- name: どの絵でも\n(?: {14}.*\n| {16}.*\n)+/, '')
          .replace(/ {10}quit:\n {12}- me: やめた。\n/, ''),
      ),
    );
    expect(stuck.findings.some((f) => f.severity === 'error')).toBe(true);
  });
});
