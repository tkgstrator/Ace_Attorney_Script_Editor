// DS 版の第 5 話だけの遊び（指紋・映像・ツボ）を、範囲を選ぶ（pick）ステップにする変換のテスト。
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
    ],
    persons: [{ slot: 4, person: 7, icon: 10, rect: [34, 110, 44, 44] }],
    flags: { tutorial: 27, glove: 28 },
  },
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
  chars: { '20': { name: '糸鋸 圭介', name_id: 0 } },
  evidence: [{ id: 15, icon: 10 }],
  evidenceStart: [],
  sounds: new Map(),
  blipKinds: [],
  court: { common_wrong: [], common_item: 72, parts: [] },
  recordText: { '15': { name: '糸鋸 圭介（30）', desc: '刑事' } },
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
    expect(ctx.extraScenes.get('fp0_match')![0]).toMatchObject({
      profiles: true,
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
