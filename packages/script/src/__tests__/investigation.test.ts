// 探索編（場所・探偵メニュー）と、章を編に分けた書き方のテスト
import { type Beat, Engine } from '@gyakusai/core';
import { describe, expect, it } from 'vitest';
import { loadScenario } from '../load.ts';

function load(yaml: string) {
  const { scenario, diagnostics } = loadScenario(yaml);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (!scenario)
    throw new Error(errors.map((d) => `${d.line}:${d.column} ${d.message}`).join('\n'));
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
title: 第1話
player: me
characters:
  me: { name: 私 }
  maya: { name: マヤ }
evidence:
  badge: { name: バッジ, description: "" }
  knife: { name: ナイフ, description: "" }
flags:
  ready: false
start: { scene: intro }
parts:
  - id: inv
    kind: investigation
    title: 探偵パート
    scenes:
      intro:
        - me: 事務所に来た。
        - investigate: office
    places:
      office:
        name: 事務所
        person: maya
        enter:
          - if: not visited(office)
            then:
              - maya: いらっしゃい。
        examine:
          - id: desk
            area: [0, 100, 50, 40]
            then:
              - me: 机だ。
              - give: knife
        talk:
          - id: case
            topic: 事件について
            then:
              - maya: 大変なの。
          - topic: 秘密
            when: seen(case)
            then:
              - maya: 秘密よ。
              - set: { ready: true }
        present:
          knife:
            - maya: ナイフね。
        move:
          - to: street
          - to: court_door
            when: ready
      street:
        name: 通り
        examine:
          - area: [0, 0, 256, 192]
            then:
              - me: 通りだ。
        move: [office]
      court_door:
        name: 法廷の前
        enter:
          - me: 法廷へ行こう。
          - goto: trial_start
  - id: trial
    kind: trial
    title: 法廷パート
    scenes:
      trial_start:
        - me: 開廷だ。
        - end: true
`;

describe('探索編', () => {
  it('場所へ行くと、来たときのブロックの後に探偵メニューになる', () => {
    const e = new Engine(load(CHAPTER));
    const { beat, lines } = skip(e);
    expect(lines).toEqual(['事務所に来た。', 'いらっしゃい。']);
    expect(beat).toMatchObject({
      kind: 'investigate',
      place: 'office',
      name: '事務所',
      person: 'maya',
      present: true,
    });
    expect(e.state.stage).toMatchObject({ character: 'maya', location: 'office' });
    if (beat.kind !== 'investigate') throw new Error();
    expect(beat.move.map((m) => m.id)).toEqual(['street']);
    expect(beat.talk).toEqual([{ id: 'case', topic: '事件について', seen: false }]);
  });

  it('話すと印が付き、印を条件にした話題が出る', () => {
    const e = new Engine(load(CHAPTER));
    skip(e);
    e.talk('case');
    expect(skip(e).lines).toEqual(['大変なの。']);
    const b = e.beat;
    if (b.kind !== 'investigate') throw new Error();
    expect(b.talk).toEqual([
      { id: 'case', topic: '事件について', seen: true },
      { id: 'office_talk2', topic: '秘密', seen: false },
    ]);
  });

  it('調べる範囲の中なら、そのブロック。外なら既定の反応', () => {
    const e = new Engine(load(CHAPTER));
    skip(e);
    e.examine(10, 110);
    expect(skip(e).lines).toEqual(['机だ。']);
    expect(e.state.evidence).toEqual(['knife']);
    expect(e.state.seen).toContain('desk');
    e.examine(200, 10);
    expect(skip(e).lines).toEqual(['特に気になるものはない。']);
  });

  it('つきつけ: 正解のブロックと、見当違いの既定の反応', () => {
    const e = new Engine(
      load(
        `${CHAPTER.replace('start: { scene: intro }', 'start: { scene: intro, evidence: [badge, knife] }')}`,
      ),
    );
    skip(e);
    e.present('knife');
    expect(skip(e).lines).toEqual(['ナイフね。']);
    e.present('badge');
    expect(skip(e).lines).toEqual(['特に反応はなかった。']);
    expect(e.beat.kind).toBe('investigate');
  });

  it('つきつけの「くらえ！」は裁判編だけで出る（探索編の場所・つきつけの要求では出ない）', () => {
    const yaml = CHAPTER.replace(
      'start: { scene: intro }',
      'start: { scene: intro, evidence: [knife] }',
    )
      .replace(
        '        - me: 事務所に来た。\n',
        '        - me: 事務所に来た。\n        - demand: 見せて\n          present: { knife: [{ me: 探索編の正解 }] }\n',
      )
      .replace(
        '        - me: 開廷だ。\n',
        '        - me: 開廷だ。\n        - demand: 証拠を\n          present: { knife: [{ me: 裁判編の正解 }] }\n',
      );
    const e = new Engine(load(yaml));
    e.advance();
    expect(e.beat.kind).toBe('demand');
    e.present('knife');
    expect(e.beat).toMatchObject({ kind: 'line', text: '探索編の正解' });
    skip(e);
    e.present('knife');
    expect(e.beat).toMatchObject({ kind: 'line', text: 'ナイフね。' });

    const t = new Engine(load(yaml));
    t.jumpTo('trial_start');
    t.advance();
    expect(t.beat.kind).toBe('demand');
    t.present('knife');
    expect(t.beat).toMatchObject({ kind: 'shout', shout: 'takethat' });
  });

  it('移動して、条件付きの行き先から次の編へ進む', () => {
    const e = new Engine(load(CHAPTER));
    skip(e);
    e.move('street');
    expect(skip(e).beat).toMatchObject({
      kind: 'investigate',
      place: 'street',
      person: null,
      present: false,
    });
    e.move('office');
    expect(skip(e).lines).toEqual([]); // 2 回目は「いらっしゃい」を言わない
    expect(() => e.move('court_door')).toThrow();
    e.talk('case');
    skip(e);
    e.talk('office_talk2');
    skip(e);
    e.move('court_door');
    const { beat, lines } = skip(e);
    expect(lines).toEqual(['法廷へ行こう。', '開廷だ。']);
    expect(e.state.stage.location).toBeNull(); // 場所の背景は残らない
    expect(beat.kind).toBe('end');
  });

  it('セーブデータから探偵メニューを復元できる', () => {
    const sc = load(CHAPTER);
    const e = new Engine(sc);
    skip(e);
    e.talk('case');
    skip(e);
    const again = new Engine(sc, e.snapshot());
    expect(again.beat).toMatchObject({ kind: 'investigate', place: 'office' });
    expect(again.state.seen).toEqual(['case']);
  });

  it('編の一覧が出力される', () => {
    expect(load(CHAPTER).parts).toEqual([
      {
        id: 'inv',
        kind: 'investigation',
        title: '探偵パート',
        scenes: ['intro', 'office', 'street', 'court_door'],
      },
      { id: 'trial', kind: 'trial', title: '法廷パート', scenes: ['trial_start'] },
    ]);
  });
});

describe('探索編の検証', () => {
  const errors = (yaml: string) =>
    loadScenario(yaml)
      .diagnostics.filter((d) => d.severity === 'error')
      .map((d) => d.message);

  it('未定義の場所・話題の印、場所への goto、裁判編の場所をエラーにする', () => {
    const bad = CHAPTER.replace('- investigate: office', '- investigate: nowhere')
      .replace('when: seen(case)', 'when: seen(nothing)')
      .replace('- goto: trial_start', '- goto: street');
    const msgs = errors(bad);
    expect(msgs).toContain('未定義の場所です: nowhere');
    expect(msgs).toContain('未定義の「調べる」「話す」の ID です: nothing');
    expect(msgs.some((m) => m.includes('「street」は場所です'))).toBe(true);
  });

  it('シーンと場所の ID の重複、背景の左・上の端からはみ出す範囲をエラーにする', () => {
    const bad = CHAPTER.replace(
      'trial_start:\n        - me: 開廷だ。',
      'office:\n        - me: 開廷だ。',
    ).replace('area: [0, 100, 50, 40]', 'area: [-10, 100, 50, 40]');
    const msgs = errors(bad);
    expect(msgs.some((m) => m.includes('ID「office」が重複'))).toBe(true);
    expect(msgs.some((m) => m.includes('はみ出して'))).toBe(true);
  });
});
