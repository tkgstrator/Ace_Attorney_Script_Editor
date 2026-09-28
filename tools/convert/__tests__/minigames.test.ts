// DS 版の第 5 話だけの遊び（指紋・映像・ツボ・金庫）を、範囲を選ぶ（pick）・人物を選ぶ（nominate）ステップにする変換のテスト。
// 表（tables/minigames.json の形）と項目は作りもの。
import { describe, expect, test } from 'bun:test';
import { Context } from '../context.ts';
import { dayStartFlags } from '../investigation-setup.ts';
import type { Minigames } from '../minigames.ts';
import { prepareMinigames } from '../minigames.ts';
import { convertOps } from '../section.ts';
import type { Entry, Op, Tables } from '../types.ts';

let at = 0;
const next = () => {
  at += 2;
  return at;
};
const c = (op: number, ...args: number[]): Op => ({ at: next(), op, name: `op${op}`, args });
const t = (text: string): Op => ({ at: next(), op: 'text', text });
const sec = (section: number, script: 'story' | '070' = 'story') => ({
  raw: section + 0x80,
  section,
  script,
});

const mg: Minigames = {
  fingerprint: {
    events: [
      { event: 0, ...sec(1) },
      { event: 1, ...sec(2) },
      { event: 2, ...sec(3) },
      { event: 3, ...sec(4) },
      { event: 4, ...sec(5) },
      { event: 6, ...sec(7) },
      { event: 8, ...sec(73, '070') },
      { event: 9, ...sec(74, '070') },
    ],
    variants: [
      {
        variant: 0,
        bg: 128,
        answer_person: 7,
        spots: [
          { index: 0, area: [10, 10, 5, 5], real: false },
          { index: 1, area: [40, 40, 8, 8], real: true },
        ],
        success: sec(8),
        can_quit: false,
      },
      {
        variant: 1,
        bg: 129,
        answer_person: 2,
        spots: [
          { index: 0, area: [89, 49, 17, 17], real: false },
          { index: 1, area: [115, 35, 16, 17], real: true },
        ],
        success: sec(3),
        can_quit: true,
      },
    ],
    flow: { back: [3, 8, 8], fake: [2, 9, 9], wrong: [4, null, 7] },
    persons: [
      { slot: 1, person: 2, icon: 11, rect: [82, 62, 44, 44] },
      { slot: 0, person: 7, icon: 10, rect: [34, 62, 44, 44] },
    ],
    flags: { tutorial: 27, glove: 28 },
  },
  nominations: [{ n: 3, answer_person: 2, answer: sec(2), wrong: sec(1) }],
  safe: {
    buttons: [
      { index: 0, label: '1', area: [80, 24, 32, 32] },
      { index: 1, label: '2', area: [112, 24, 32, 32] },
      { index: 2, label: 'もどる', area: [144, 24, 32, 32] },
    ],
    answer: [0, 0],
    delete: 2,
    correct: sec(2),
    wrong: sec(1),
  },
  choices: [
    {
      ui: 51,
      about: 'ツボの正しい見かたを提示する',
      options: [
        { text: '正しい', section: sec(2) },
        { text: 'ちがう', section: sec(1) },
      ],
    },
  ],
  video: {
    variants: [{ section: sec(0), variant: 1 }],
    records: [
      { frames: [0, 10], sections: [sec(1), sec(2)] },
      { frames: [20, 30], sections: [sec(3), sec(4)] },
    ],
    miss: [sec(5), sec(6)],
    keyframes: [
      { frame: 5, key: 'movie2_0005', areas: [{ record: 0, area: [1, 2, 3, 4] }] },
      { frame: 25, key: 'movie2_0025', areas: [{ record: 1, area: [5, 6, 7, 8] }] },
    ],
  },
  vase: {
    flag: 29,
    quit: { unset: sec(1), set: sec(9) },
    complete: { unset: sec(2), set: sec(10) },
    bg: { unset: 192, set: 193 },
    area: [24, 8, 208, 176],
  },
};

const tables = {
  game: 'aa1',
  names: [],
  chars: { '20': { name: '糸鋸 圭介', name_id: 0 }, '21': { name: '罪門 恭介', name_id: 1 } },
  evidence: [
    { id: 15, icon: 10 },
    { id: 16, icon: 11 },
  ],
  evidenceStart: [],
  sounds: new Map(),
  blipKinds: [],
  court: { common_wrong: [], common_item: 72, parts: [] },
  recordText: {
    '15': { name: '糸鋸 圭介（30）', desc: '刑事' },
    '16': { name: '罪門 恭介（33）', desc: '巡査' },
  },
  minigames: mg,
} as unknown as Tables;

const entry = (body: Op[][]): Entry => ({
  entry: 0,
  lang: 'ja',
  sections: body.length,
  labels: {},
  body: body.map((ops, section) => ({ section, ops })),
});
const result = (s: string) => [c(0), t(s), c(116, 5, 0), c(21), c(13)];
const convert = (ctx: Context, s: number) =>
  convertOps(ctx, s, ctx.entry.body[s]!.ops, { gotoSteps: (x) => [{ goto: `s${x}` }] });

describe('範囲を選ぶ形にする遊び', () => {
  test('映像: 場面の絵ごとの範囲・外れを、区画で決まる版の区画へ', () => {
    const e = entry([
      [c(0), t('示してください'), c(116, 8, 53), c(121), c(13)],
      ...[1, 2, 3, 4, 5, 6].map((n) => result(`結果 ${n}`)),
    ]);
    expect(convert(new Context(tables, e), 0).at(-1)).toEqual({
      pick: '映像の1点を指し示す',
      images: ['movie2_0005', 'movie2_0025'],
      areas: [
        // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
        { area: [1, 2, 3, 4], image: 0, then: [{ goto: 's2' }] },
        // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
        { area: [5, 6, 7, 8], image: 1, then: [{ goto: 's4' }] },
      ],
      miss: [{ goto: 's6' }],
    });
  });

  test('ツボ: 一度組み立てたかで絵・区画が替わる。区画の無い版は出さない', () => {
    const body = [[c(0), t('組み立てよう'), c(116, 8, 50), c(21), c(13)], result('a'), result('b')];
    const only = convert(new Context(tables, entry(body)), 0).at(-1);
    expect(only).toEqual({
      pick: 'カケラを組み立てる',
      images: ['bg192'],
      // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
      areas: [{ area: [24, 8, 208, 176], then: [{ set: { f_0_29: true } }, { goto: 's2' }] }],
      quit: [{ goto: 's1' }],
    });
    const both = entry([...body, ...[3, 4, 5, 6, 7, 8, 9, 10].map((n) => result(`${n}`))]);
    const step = convert(new Context(tables, both), 0).at(-1) as Record<string, any>;
    expect(step.if).toBe('f_0_29');
    expect(step.then[0].images).toEqual(['bg193']);
    expect(step.then[0].quit).toEqual([{ goto: 's9' }]);
  });

  test('指紋: 選ぶ・検出する・照合のシーンを作り、結果の区画の 21 は遊びに戻る', () => {
    const e = entry([
      [c(0), t('試してみよう'), c(116, 9, 0), c(21), c(13)],
      ...[1, 2, 3, 4].map((n) => result(`出来事 ${n}`)),
      [c(0), t('一致しない'), c(13)], // §5: そのまま §6 へ
      result('考えてみよう'), // §6: 照合に戻る
      result('検出できた'), // §7
      [c(0), t('イトノコ刑事の指紋'), c(21), c(13)], // §8: 成功
    ]);
    const ctx = new Context(tables, e);
    prepareMinigames(ctx);
    expect(convert(ctx, 0).at(-1)).toEqual({ goto: 's001' });
    const pick = ctx.extraScenes.get('fp0')![0] as Record<string, any>;
    expect(pick.images).toEqual(['bg128']);
    expect(pick.areas.map((a: { when: string }) => a.when)).toEqual(['not f_0_28', 'f_0_28']);
    // 照合: 人物を選ぶ画面の枠の順（slot）に人物を並べる
    expect(ctx.extraScenes.get('fp0_match')![0]).toEqual({
      nominate: '',
      people: ['c20', 'c21'],
      present: { c20: [{ goto: 's008' }] },
      wrong: [{ goto: 's005' }],
    });
    const back = (s: number) => convert(ctx, s).at(-1);
    expect([1, 2, 3, 4, 6, 7].map(back)).toEqual(
      ['fp0', 'fp0_dust', 'fp0', 'fp0', 'fp0_match', 'fp0_match'].map((g) => ({ goto: g })),
    );
  });
});

test('ツボを組み立てたかのフラグは、パート 22 の始めでしか消さない', () => {
  expect(dayStartFlags(28, ['f_0_29', 'f_0_3'])).toEqual({ f_0_3: false });
  expect(dayStartFlags(22, ['f_0_29', 'f_0_3'])).toEqual({ f_0_29: false, f_0_3: false });
});

describe('指紋の版 1・人物の指名・金庫・選択肢で近似する遊び', () => {
  test('指紋の版 1: 説明なし・やめられる・070 の区画はシーン・照合の外れは選び直し', () => {
    const e = entry([
      [c(0), t('探そう'), c(116, 9, 1), c(21), c(13)],
      result('a'),
      result('b'),
      [c(0), t('罪門の指紋'), c(22), c(13)], // §3: 成功
    ]);
    const ctx = new Context(tables, e);
    prepareMinigames(ctx);
    expect(convert(ctx, 0).at(-1)).toEqual({ goto: 'fp1' });
    const pick = ctx.extraScenes.get('fp1')![0] as Record<string, any>;
    expect(pick.areas.map((a: { when?: string }) => a.when)).toEqual([undefined, undefined]);
    expect(pick.quit[0]).toEqual({ ui: { record: true } });
    const dust = ctx.extraScenes.get('fp1_dust')![0] as Record<string, any>;
    expect(dust.choice[0].then[0].then).toEqual([{ goto: 'fp1_match' }]);
    expect(dust.choice[0].then[0].else).toEqual([{ goto: 'fp1_ev9' }]);
    expect(dust.choice[1].then).toEqual([{ goto: 'fp1_ev8' }]);
    expect(ctx.extraScenes.get('fp1_match')![0]).toEqual({
      nominate: '',
      people: ['c20', 'c21'],
      present: { c21: [{ goto: 's003' }] },
    });
  });

  test('人物の指名: 表の正解の人物・区画、外れの区画', () => {
    const e = entry([
      [c(0), t('だれ?'), c(116, 10, 3), c(21), c(13)],
      result('外れ'),
      result('正解'),
    ]);
    expect(convert(new Context(tables, e), 0).at(-1)).toEqual({
      nominate: '',
      people: ['c20', 'c21'],
      present: { c21: [{ goto: 's2' }] },
      wrong: [{ goto: 's1' }],
    });
  });

  test('金庫: 1 字ずつのシーン。最初に違えた位置を覚え、もどるで消す', () => {
    const e = entry([
      [c(0), t('入れよう'), c(116, 8, 52), c(21), c(13)],
      result('違う'),
      result('開いた'),
    ]);
    const ctx = new Context(tables, e);
    expect(convert(ctx, 0).slice(-2)).toEqual([{ set: { safe_miss: 0 } }, { goto: 'safe0' }]);
    const s0 = ctx.extraScenes.get('safe0')![0] as Record<string, any>;
    expect(s0.areas.map((a: { name: string }) => a.name)).toEqual(['1', '2']);
    expect(s0.areas[0].then).toEqual([{ goto: 'safe1' }]);
    expect(s0.areas[1].then[0]).toEqual({
      if: 'safe_miss == 0',
      // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
      then: [{ set: { safe_miss: 1 } }],
    });
    const s1 = ctx.extraScenes.get('safe1')![0] as Record<string, any>;
    expect(s1.areas[2].then).toEqual([
      // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
      { if: 'safe_miss == 1', then: [{ set: { safe_miss: 0 } }] },
      { goto: 'safe0' },
    ]);
    expect(s1.areas[0].then.at(-1)).toEqual({
      if: 'safe_miss == 0',
      // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
      then: [{ goto: 's002' }],
      else: [{ set: { safe_miss: 0 } }, { goto: 's001' }],
    });
  });

  test('選択肢で近似する遊び: ARM9 の結果の区画', () => {
    const e = entry([
      [c(0), t('提示せよ'), c(116, 8, 51), c(21), c(13)],
      result('違う'),
      result('正しい'),
    ]);
    expect(convert(new Context(tables, e), 0).at(-1)).toEqual({
      choice: [
        // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
        { text: '正しい', then: [{ goto: 's2' }] },
        // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
        { text: 'ちがう', then: [{ goto: 's1' }] },
      ],
    });
  });
});
