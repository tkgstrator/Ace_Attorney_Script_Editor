// 証拠品を詳しく調べる（evidence.<ID>.examine）のテスト
import { Engine, type Beat } from '@gyakusai/core';
import { describe, expect, it } from 'vitest';
import { loadScenario } from '../load.ts';
import { verifyScenario } from '../verify.ts';

function load(yaml: string) {
  const { scenario, diagnostics } = loadScenario(yaml);
  if (!scenario)
    throw new Error(diagnostics.map((d) => `${d.line}:${d.column} ${d.message}`).join('\n'));
  return { scenario, diagnostics };
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
title: 第5話
characters:
  me: { name: 私 }
  akane: { name: 茜 }
evidence:
  phone:
    name: 携帯電話
    description: 現場に落ちていた。
    examine:
      - spot: 画面
        when: not opened
        then:
          - set: { opened: true }
          - akane: リダイヤルの表示ですね。
      - spot: 発信の記録
        when: opened
        then:
          - akane: 最後にかけた相手が分かります！
          - goto: found
      - spot: 裏
        then:
          - me: シールが貼ってある。
  badge: { name: バッジ, description: "" }
flags:
  opened: false
start: { scene: intro, evidence: [phone, badge] }
parts:
  - id: inv
    kind: investigation
    title: 探偵パート
    scenes:
      intro:
        - investigate: office
      found:
        - me: 手がかりだ。
        - demand: 携帯電話で分かったことは？
          present:
            badge:
              - end: true
    places:
      office:
        name: 事務所
        move: [hall]
      hall:
        name: 廊下
        move: [office]
`;

describe('証拠品を詳しく調べる', () => {
  it('examine のある持っている証拠品だけが Beat の inspect に出る', () => {
    const { scenario } = load(CHAPTER);
    expect(scenario.evidence.phone!.inspect).toBe('@inspect:phone');
    expect(scenario.evidence.badge!.inspect).toBeUndefined();
    const e = new Engine(scenario);
    const b = e.beat;
    expect(b.kind === 'investigate' && b.inspect).toEqual(['phone']);
    expect(() => e.inspect('badge')).toThrow();
  });

  it('場所を選ぶ選択肢（条件つき・「やめる」つき）を出し、終わると探偵メニューに戻る', () => {
    const { scenario } = load(CHAPTER);
    const e = new Engine(scenario);
    e.inspect('phone');
    expect(e.beat).toEqual({ kind: 'choice', options: ['画面', '裏', 'やめる'] });
    e.choose(0);
    expect(skip(e).lines).toEqual(['リダイヤルの表示ですね。']);
    expect(e.beat.kind).toBe('investigate');
    expect(e.state.scene).toBe('office');
    expect(e.state.inspectFrom).toBeNull();
    // 2 回目は条件が変わる。「やめる」でも戻る
    e.inspect('phone');
    expect(e.beat).toEqual({ kind: 'choice', options: ['発信の記録', '裏', 'やめる'] });
    e.choose(2);
    expect(e.beat.kind).toBe('investigate');
  });

  it('then の中で goto したら戻らずに進み、つきつけの要求の場面でも調べられる', () => {
    const { scenario } = load(CHAPTER);
    const e = new Engine(scenario);
    e.move('hall');
    e.inspect('phone');
    e.choose(0);
    skip(e);
    expect(e.state.scene).toBe('hall');
    e.inspect('phone');
    e.choose(0);
    const { beat, lines } = skip(e);
    expect(lines).toEqual(['最後にかけた相手が分かります！', '手がかりだ。']);
    expect(beat.kind === 'demand' && beat.inspect).toEqual(['phone']);
    // つきつけの要求の途中で調べても、要求に戻る
    e.inspect('phone');
    e.choose(1);
    expect(skip(e).beat.kind).toBe('demand');
    e.present('badge');
    expect(skip(e).beat.kind).toBe('end');
  });

  it('examine の中の未定義の参照はエラーになる', () => {
    const bad = CHAPTER.replace('- goto: found', '- goto: nowhere');
    expect(loadScenario(bad).scenario).toBeNull();
  });
});

const COURT = `
id: court
title: 法廷
defaults: { autoShow: false }
characters:
  me: { name: 私 }
  w: { name: 証人 }
  ema: { name: 茜 }
evidence:
  phone:
    name: 携帯電話
    description: 第 1 回の法廷の間だけ持っている
    examine:
      - spot: 画面
        then:
          - show: ema
          - ema: リダイヤルですね。
          - set: { opened: true }
      - spot: 裏
        then:
          - goto: after
flags:
  opened: false
start: { scene: s, evidence: [phone] }
scenes:
  s:
    - show: w
    - w: 一つめの台詞。
    - ui: { record: false }
    - w: 法廷記録は見られない。
    - ui: { record: true }
    - choice:
        - text: 尋問へ
          then:
            - goto: t
  t:
    testimony: 証言
    witness: w
    statements:
      - text: 見ました。
        present:
          phone:
            - end: true
      - text: 本当です。
  after:
    - take: phone
    - me: 電話はしまった。
    - end: true
`;

describe('法廷記録を開ける場面ならいつでも詳しく調べる', () => {
  it('台詞の途中で調べると、調べ終えてその台詞に戻る（表示も戻す）', () => {
    const e = new Engine(load(COURT).scenario);
    const b = e.beat;
    expect(b.kind === 'line' && b.text === '一つめの台詞。' && b.inspect).toEqual(['phone']);
    const pc = e.state.pc;
    e.inspect('phone');
    // 調べている間は、もう一度は調べられない
    expect(e.beat).toEqual({ kind: 'choice', options: ['画面', '裏', 'やめる'] });
    e.choose(0);
    expect(e.state.stage.character).toBe('ema');
    expect(e.beat.kind === 'line' && e.beat.text).toBe('リダイヤルですね。');
    e.advance();
    expect(e.beat.kind === 'line' && e.beat.text).toBe('一つめの台詞。');
    expect(e.state.scene).toBe('s');
    expect(e.state.pc).toBe(pc);
    expect(e.state.flags.opened).toBe(true);
    expect(e.state.stage.character).toBe('w');
    expect(e.state.inspectFrom).toBeNull();
  });

  it('法廷記録を使えなくしている間は調べられず、選択肢・証言（聞く・尋問）では調べられる', () => {
    const e = new Engine(load(COURT).scenario);
    e.advance();
    expect(e.beat.kind === 'line' && e.beat.inspect).toBeFalsy();
    expect(() => e.inspect('phone')).toThrow(/今は詳しく調べられません/);
    e.advance();
    expect(e.beat.kind === 'choice' && e.beat.inspect).toEqual(['phone']);
    e.inspect('phone');
    e.choose(2); // やめる
    expect(e.beat.kind).toBe('choice');
    e.choose(0);
    e.advance(); // 証言開始
    expect(e.beat.kind === 'statement' && !e.beat.cross && e.beat.inspect).toEqual(['phone']);
    e.advance();
    e.advance();
    e.advance(); // 本当です。→ 尋問開始 → 尋問
    const b = e.beat;
    expect(b.kind === 'statement' && b.cross && b.index).toBe(0);
    e.advance();
    e.inspect('phone');
    e.choose(0);
    e.advance();
    // 尋問の同じ証言（2 つ目）に戻る
    const back = e.beat;
    expect(back.kind === 'statement' && back.cross && back.text).toBe('本当です。');
  });

  it('then の中で goto したら戻らずに進む', () => {
    const e = new Engine(load(COURT).scenario);
    e.inspect('phone');
    e.choose(1);
    expect(skip(e).lines).toEqual(['電話はしまった。']);
    expect(e.beat.kind).toBe('end');
    expect(e.state.inspectFrom).toBeNull();
  });

  it('整合性チェック: 法廷の台詞の途中でしか調べられない証拠品のシーンにも着く', () => {
    const r = verifyScenario(load(COURT).scenario);
    expect(r.findings.filter((f) => f.message.includes('@inspect'))).toEqual([]);
    expect(r.findings.filter((f) => f.severity === 'error')).toEqual([]);
  });

  it('整合性チェック: 台詞の途中で調べたときにだけ起きる詰みも見つける', () => {
    const r = verifyScenario(
      load(`
id: t
title: t
player: a
characters:
  a: { name: A }
evidence:
  box:
    name: 箱
    description: 箱
    examine:
      - spot: 底
        when: mark == 0
        then:
          - set: { mark: 1 }
flags:
  mark: 0
  bad: false
start: { scene: s, evidence: [box] }
scenes:
  s:
    - a: 一つめ
    - if: mark == 1
      then:
        - set: { bad: true }
    - a: 二つめ
    - choice:
        - text: 終わる
          when: not bad
          then:
            - end: true
        - text: 待つ
    - a: 待った。
    - goto: s
`).scenario,
    );
    expect(r.findings.map((f) => f.message)).toEqual([
      '詰み: シーン「s」から先へ進めません（choice）',
    ]);
  });
});
