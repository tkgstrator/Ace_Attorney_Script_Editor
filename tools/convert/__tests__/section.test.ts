// 区画の変換（台詞の組み立て・流れ）を、表を最小限にした作りものの項目で確かめる。
import { describe, expect, test } from 'bun:test';
import { Context } from '../context.ts';
import { cutOps } from '../scenario.ts';
import { convertOps } from '../section.ts';
import type { Entry, Op, Tables } from '../types.ts';
import { plain } from '../writer.ts';

const tables: Tables = {
  names: [
    { id: 0, text: { ja: '', en: '' } },
    { id: 2, text: { ja: 'ナルホド', en: 'Phoenix' } },
    { id: 8, text: { ja: 'サイバンカン', en: 'Judge' } },
  ],
  chars: { 2: { name: '成歩堂 龍一', name_id: 2 }, 8: { name: '裁判長', name_id: 8 } },
  evidence: [{ id: 6, text_ja: { name: '解剖記録', desc: '説明' } }],
  evidenceStart: [],
  sounds: new Map([
    [17, 'BGM017'],
    [58, 'SE010'],
  ]),
  blipKinds: [],
  court: { common_wrong: [], common_item: 72, parts: [] },
};

let at = 0;
const c = (op: number, ...args: number[]): Op => ({ at: (at += 2), op, name: `op${op}`, args });
const t = (text: string): Op => ({ at: (at += 2), op: 'text', text });
const entry = (body: Op[][]): Entry => ({
  entry: 0,
  lang: 'ja',
  sections: body.length,
  labels: {},
  body: body.map((ops, section) => ({ section, ops })),
});
const run = (ops: Op[]) => {
  const ctx = new Context(tables, entry([ops, []]));
  return { steps: convertOps(ctx, 0, ops), ctx };
};

describe('台詞の組み立て', () => {
  test('1 ページ = 1 つの say。待ち・改行・色・速さは文中コマンド、人物は show', () => {
    const { steps } = run([
      c(0),
      c(30, 2, 2, 1),
      c(14, 2 << 8),
      c(11, 5),
      t('あ、'),
      c(12, 10),
      t('はい'),
      c(1),
      c(3, 1),
      t('赤'),
      c(3, 0),
      c(2),
      c(13),
    ]);
    expect(steps).toEqual([
      { show: 'phoenix', talk: 2, idle: 1 },
      { phoenix: '[speed 5]あ、[wait 10]はい\n[color red]赤' },
      { goto: 's001' },
    ]);
  });

  test('ページの前の演出はステップ、文の途中の揺れ・フラッシュ・効果音は文中コマンド', () => {
    const { steps } = run([
      c(14, 8 << 8),
      c(6, 17, 1),
      c(18, 769, 8, 31),
      t('静粛に'),
      c(39, 30, 1),
      c(6, 17, 1),
      c(2),
    ]);
    expect(steps).toEqual([
      { se: 'BGM017' },
      { flash: true },
      { judge: '静粛に[shake 30 1][se BGM017]' },
    ]);
  });

  test('文の途中の人物・背景の切り替えは文中コマンド、止まる命令は台詞の後に回す', () => {
    expect(run([c(14, 2 << 8), t('あ'), c(30, 2, 9, 8), c(27, 5), t('い'), c(2)]).steps).toEqual([
      { phoenix: 'あ[show phoenix 9 8][location witness]い' },
    ]);
    const { steps, ctx } = run([c(14, 2 << 8), t('あ'), c(43), t('い'), c(2)]);
    expect(steps).toEqual([{ phoenix: 'あい' }, { penalty: 1 }]);
    expect([...ctx.stats.gaps.keys()].some((k) => k.includes('台詞の途中'))).toBe(true);
  });

  test('心の声（青）は color: blue、名前なしはナレーション、揃え 1 の名前なしは card', () => {
    const { steps } = run([
      c(14, 2 << 8),
      c(3, 2),
      t('（うう）'),
      c(3, 0),
      c(2),
      c(14, 0),
      t('……'),
      c(2),
      c(93, 1),
      c(3, 3),
      t('8月3日'),
      c(1),
      t('法廷'),
      c(2),
    ]);
    expect(steps[0]).toEqual({ say: 'phoenix', text: '（うう）', color: 'blue' });
    expect(steps[1]).toEqual({ narrate: '……' });
    expect(steps).toContainEqual({ card: '8月3日\n法廷' });
  });

  test('フェードは止まらない（nowait）、枠は textbox、ボタンを待たずに消える文は auto', () => {
    const { steps } = run([
      c(18, 513, 1, 31),
      c(12, 7),
      c(28, 1),
      c(28, 0),
      t('a'),
      c(12, 9),
      c(46),
    ]);
    expect(steps).toEqual([
      { fade: 'out', frames: 16, nowait: true },
      { wait: 7 },
      { textbox: false },
      { textbox: true },
      { say: null, text: 'a[wait 9]', auto: true },
    ]);
  });

  test('53 の区画の中の先への飛び越しは if のブロック', () => {
    const ops: Op[] = [
      {
        at: 0,
        op: 53,
        name: 'if_flag',
        args: [(5 << 8) | 1, 20],
        target: { section: null, offset: 20 },
      },
      { at: 10, op: 'text', text: 'x' },
      { at: 12, op: 2, name: 'page', args: [] },
      { at: 20, op: 'text', text: 'y' },
      { at: 22, op: 2, name: 'page', args: [] },
    ];
    expect(run(ops).steps).toEqual([
      { if: 'not f_0_5', then: [{ narrate: 'x' }] },
      { narrate: 'y' },
    ]);
  });
});

describe('流れ', () => {
  test('page_jump・end・set_next の飛び先', () => {
    expect(run([t('a'), c(10, 128 + 5)]).steps).toEqual([{ narrate: 'a' }, { goto: 's005' }]);
    expect(run([c(32, 128 + 9), c(13)]).steps).toEqual([{ goto: 's009' }]);
  });

  test('選択肢の文は entry.choices から', () => {
    const ops: Op[] = [
      t('どれ?'),
      c(7),
      {
        at: 100,
        op: 8,
        name: 'choice2',
        args: [130, 131],
        targets: [
          { section: 2, offset: 0 },
          { section: 3, offset: 0 },
        ],
      },
    ];
    const e = entry([ops]);
    e.choices = { 0: { textures: [0, 1], text: ['はい', 'いいえ'] } };
    const ctx = new Context(tables, e);
    const steps = convertOps(ctx, 0, ops);
    expect(steps.at(-1)).toEqual({
      choice: [
        { text: 'はい', then: [{ goto: 's002' }] },
        { text: 'いいえ', then: [{ goto: 's003' }] },
      ],
    });
  });

  test('区画の途中のラベルで切る', () => {
    const ops: Op[] = [
      { at: 0, op: 0, name: 'nop', args: [] },
      { at: 2, op: 'text', text: 'a' },
      { at: 10, op: 'text', text: 'b' },
    ];
    expect(cutOps(ops, [10]).map((p) => p.length)).toEqual([2, 1]);
  });

  test('plain は文中コマンドを外す', () => {
    expect(plain('a[wait 3]b[[c')).toBe('ab[c');
  });
});
