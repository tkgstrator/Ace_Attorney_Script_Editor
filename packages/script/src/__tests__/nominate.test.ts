// nominate（人物を選ぶ）のコンパイル・実行・整合性チェックのテスト
import { type Beat, Engine } from '@gyakusai/core';
import { describe, expect, it } from 'vitest';
import { loadScenario } from '../load.ts';
import { verifyScenario } from '../verify.ts';

function load(yaml: string) {
  const { scenario, diagnostics } = loadScenario(yaml);
  if (!scenario)
    throw new Error(diagnostics.map((d) => `${d.line}:${d.column} ${d.message}`).join('\n'));
  return scenario;
}

const errors = (yaml: string): string[] =>
  loadScenario(yaml)
    .diagnostics.filter((d) => d.severity === 'error')
    .map((d) => d.message);

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
  cop: { name: 刑事, profile: { name: 糸鋸 圭介, description: 刑事 } }
  girl: { name: 少女 }
  boss: { name: 局長 }
evidence: {}
flags:
  miss: 0
start: { scene: intro }
parts:
  - id: p
    kind: trial
    title: 法廷
    scenes:
      intro:
        - me: だれだろう。
        - nominate: 指紋のヌシは？
          people: [girl, cop, boss]
          present:
            cop:
              - me: 刑事だ。
          wrong:
            - me: ちがう。
            - add: { miss: 1 }
        - me: 次へ。
        - end: true
`;

describe('nominate', () => {
  it('人物ごとの範囲（DS 版の枠の位置）を持つ pick の命令にする', () => {
    const sc = load(CHAPTER);
    const ins = sc.scenes.intro!.program.find((i) => i.op === 'pick');
    if (ins?.op !== 'pick') throw new Error('pick がありません');
    expect(ins.prompt).toBe('指紋のヌシは？');
    expect(ins.images).toEqual([]);
    expect(ins.options.map((o) => [o.kind, o.person, o.area])).toEqual([
      ['area', 'girl', [34, 62, 44, 44]],
      ['area', 'cop', [82, 62, 44, 44]],
      ['area', 'boss', [130, 62, 44, 44]],
    ]);
    // 外れの人物は同じ行き先（wrong）
    expect(ins.options[0]!.to).toBe(ins.options[2]!.to);
  });

  it('外れは wrong の後にもう一度、正解は present の後に次のステップへ', () => {
    const e = new Engine(load(CHAPTER));
    lines(e);
    const b = e.beat as Extract<Beat, { kind: 'pick' }>;
    expect(b.areas.map((a) => a.person)).toEqual(['girl', 'cop', 'boss']);
    expect(b.miss).toBe(false);
    // 顔の外は選べない
    expect(e.pickAt(0, 0)).toBe(false);
    e.pickAt(140, 70);
    expect(lines(e)).toEqual(['ちがう。']);
    expect(e.beat.kind).toBe('pick');
    e.pick(1);
    expect(lines(e)).toEqual(['刑事だ。', '次へ。']);
  });

  it('wrong を省くと、何もせず選び直す', () => {
    const e = new Engine(load(CHAPTER.replace(/ {10}wrong:\n(?: {12}.*\n)+/, '')));
    lines(e);
    e.pick(0);
    expect(e.beat.kind).toBe('pick');
  });

  it('people にない正解・正解しかいない並び・知らない人物はエラー', () => {
    expect(errors(CHAPTER.replace('            cop:\n', '            nobody:\n'))).toEqual(
      expect.arrayContaining([expect.stringContaining('people にありません')]),
    );
    expect(errors(CHAPTER.replace('[girl, cop, boss]', '[cop]'))).toEqual([
      expect.stringContaining('正解でない人物がいません'),
    ]);
    expect(errors(CHAPTER.replace('[girl, cop, boss]', '[girl, cop, ghost]')).length).toBe(1);
  });

  it('整合性チェック: 人物をすべて試す', () => {
    expect(verifyScenario(load(CHAPTER)).findings.filter((f) => f.severity === 'error')).toEqual(
      [],
    );
  });
});
