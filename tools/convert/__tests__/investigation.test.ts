// 探偵パート・証言の分け方・区画の流れの、表に依らない関数のテスト。
import { describe, expect, test } from 'bun:test';
import { collectGives } from '../chapter.ts';
import { Context } from '../context.ts';
import { markNoScroll } from '../examine-area.ts';
import { localClosure, staticTargets } from '../flow.ts';
import { areaOf, buildPlaces, condOf, stripMenuReturn, whenOf } from '../investigation.ts';
import { isStorySection } from '../tables.ts';
import { splitReading } from '../testimony.ts';
import type { Entry, Op, Tables } from '../types.ts';

const tables = {
  names: [],
  chars: {},
  evidence: [],
  evidenceStart: [],
  sounds: new Map(),
  blipKinds: [],
  court: { common_wrong: [], common_item: 72, parts: [] },
} as Tables;
let at = 0;
const nextAt = () => {
  at += 2;
  return at;
};
const c = (op: number, ...args: number[]): Op => ({ at: nextAt(), op, name: `op${op}`, args });
const t = (text: string): Op => ({ at: nextAt(), op: 'text', text });
const entry = (body: Op[][]): Entry => ({
  entry: 2,
  lang: 'ja',
  sections: body.length,
  labels: {},
  body: body.map((ops, section) => ({ section, ops })),
});

describe('探偵パート', () => {
  const ctx = new Context(tables, entry([[]]), { pfx: 'p1_' });

  test('道の条件（{"0:0x41": 1, ...}）と調べる場所の条件', () => {
    expect(whenOf(ctx, { '0:0x41': 1, '0:0x42': 0 })).toBe('f_0_65 and not f_0_66');
    expect(whenOf(ctx, {})).toBe('true');
    expect(condOf(ctx, 'flag 0x49 == 1')).toBe('f_0_73');
  });

  test('調べる場所: 軸に沿った四角形はそのまま、斜めは内側、横長の背景は背景の座標のまま、背景の外は null', () => {
    expect(
      areaOf([
        [10, 20],
        [50, 20],
        [50, 60],
        [10, 60],
      ]),
    ).toEqual([10, 20, 40, 40]);
    expect(
      areaOf([
        [82, 92],
        [107, 92],
        [8, 176],
        [8, 126],
      ]),
    ).toEqual([8, 92, 74, 34]);
    expect(
      areaOf(
        [
          [300, 10],
          [340, 10],
          [340, 50],
          [300, 50],
        ],
        { w: 512, h: 192 },
      ),
    ).toEqual([300, 10, 40, 40]);
    // 背景の端で切る
    expect(
      areaOf(
        [
          [500, 10],
          [540, 10],
          [540, 50],
          [500, 50],
        ],
        { w: 512, h: 192 },
      ),
    ).toEqual([500, 10, 12, 40]);
    expect(
      areaOf([
        [300, 10],
        [340, 10],
        [340, 50],
        [300, 50],
      ]),
    ).toBeNull();
  });

  test('ブロックの最後の「探偵メニューへ戻る」を外す（if の中も）', () => {
    const back = ctx.menuReturn();
    expect(stripMenuReturn(ctx, [{ narrate: 'a' }, ...back])).toEqual([{ narrate: 'a' }]);
    expect(
      // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
      stripMenuReturn(ctx, [{ if: 'x', then: [{ narrate: 'b' }, ...back], else: [...back] }]),
      // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
    ).toEqual([{ if: 'x', then: [{ narrate: 'b' }], else: [] }]);
  });
});

describe('調べる表の、共通の台本の区画', () => {
  // 第 4 話の探偵パート 11・13・15 の調べる表には、共通の台本の §43（手がかりになるものはない。）を指すものがある。
  // 以前は項目の台本の §43（第 4 話 022 では移動先を書き換える会話）にしていて、調べると星影法律事務所へ行けなくなった
  const common = entry([[], [t('共通の文'), c(21)]]);
  const inv = {
    part: 11,
    places: [
      { id: 1, dest: [], bg: 0, every_frame: [], on_enter: [{ when: {}, do: [{ examine: 'T' }] }] },
    ],
    talk: [],
    present: { entries: [] },
    examine_tables: {
      T: [
        {
          section: { raw: 1, script: 'common', section: 1 },
          kind: 'normal',
          quad: [
            [0, 0],
            [100, 0],
            [100, 100],
            [0, 100],
          ],
        },
        {
          section: { raw: 129, script: 'story', section: 1 },
          kind: 'normal',
          quad: [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
          ],
        },
      ],
    },
  };
  const story = entry([[], [t('項目の文'), c(21)]]);
  const ctx = new Context(tables, story, { pfx: 'p11_', inv: inv as never });

  test('script が common なら共通の台本の区画、story なら項目の台本の区画', () => {
    const { places } = buildPlaces(ctx, common);
    const examine = (places.p11_place1 as { examine: { then: unknown[] }[] }).examine;
    // 小さい順なので、項目の台本（10×10）が先。項目の台本の区画はそのシーンへ行く
    expect(examine[0]!.then).toEqual([{ goto: 'p11_s001' }]);
    expect(JSON.stringify(examine[1]!.then)).toContain('共通の文');
    expect(JSON.stringify(examine[1]!.then)).not.toContain('p11_s001');
  });

  test('区画の参照が項目の台本のものか', () => {
    expect(isStorySection({ raw: 145, script: 'story', section: 17 })).toBe(true);
    expect(isStorySection({ raw: 43, script: 'common', section: 43 })).toBe(false);
    expect(isStorySection({ raw: 145, section: 17 })).toBe(true);
    expect(isStorySection({ section: 17 })).toBe(false);
  });
});

describe('区画の流れ', () => {
  test('静的な行き先と、ほかから来ない枝', () => {
    const e = entry([
      [c(8, 129, 130), c(13)].map((o, i) =>
        i === 0
          ? {
              ...o,
              targets: [
                { section: 1, offset: 0 },
                { section: 2, offset: 0 },
              ],
            }
          : o,
      ) as Op[],
      [t('a'), { ...c(10, 131), targets: [{ section: 3, offset: 0 }] } as Op],
      [t('b'), { ...c(10, 131), targets: [{ section: 3, offset: 0 }] } as Op],
      [t('c'), c(13)],
      [t('d'), c(13)],
    ]);
    expect(staticTargets(e, 0)).toEqual([1, 2]);
    expect(staticTargets(e, 3)).toEqual([4]);
    expect([...localClosure(e, [0], new Set([4]))].sort()).toEqual([1, 2, 3]);
  });

  test('証言の区画を、証言開始の前・読む・証言の後に分ける', () => {
    const ops: Op[] = [
      c(0),
      c(27, 5),
      c(40, 1),
      t('～タイトル～'),
      c(2),
      t('文1'),
      c(2),
      c(40, 0),
      t('後'),
      c(13),
    ];
    const { pre, readingOps, tailOps } = splitReading([0], () => ops as never);
    expect(pre.map((o) => o.op)).toEqual([0, 27, 'text', 2]);
    expect(readingOps[0]![1].map((o) => o.op)).toEqual(['text', 2]);
    expect(tailOps![1].map((o) => o.op)).toEqual(['text', 13]);
  });
});

describe('人物ファイルのつきつけ（探偵パート）', () => {
  // 法廷記録の番号は証拠品と人物ファイルで通し番号。表の item が人物ファイルなら、YAML では人物 ID をキーにする
  const story = entry([[], [t('正解'), c(21)], [t('既定'), c(21)]]);
  const inv = {
    part: 17,
    places: [
      {
        id: 1,
        dest: [],
        bg: 0,
        every_frame: [],
        on_enter: [{ when: {}, do: [{ char: 3, talk: 1, idle: 1 }] }],
      },
    ],
    talk: [],
    present: {
      entries: [
        {
          place: 1,
          item: 5,
          person: 3,
          section: { raw: 129, script: 'story', section: 1 },
          default: { raw: 130, script: 'story', section: 2 },
        },
        {
          place: 1,
          item: 40,
          person: 3,
          section: { raw: 129, script: 'story', section: 1 },
          default: { raw: 130, script: 'story', section: 2 },
        },
      ],
    },
    examine_tables: {},
  };
  const ctx = new Context(tables, story, { pfx: 'p17_', inv: inv as never });
  ctx.shared.profileRecords.add(5);

  test('人物ファイルの行は人物 ID、証拠品の行は証拠品 ID。表に無いものは既定の反応（presentWrong）', () => {
    const { places } = buildPlaces(ctx, null);
    const pl = places.p17_place1 as { present: Record<string, unknown>; presentWrong: unknown };
    expect(Object.keys(pl.present).sort()).toEqual(['e40', 'r5']);
    expect(ctx.characters.get('r5')?.profile?.icon).toBe('r5');
    expect(JSON.stringify(pl.presentWrong)).toContain('p17_s002');
  });

  test('法廷記録に入る証拠品（give）を集める（入れ子・同じオブジェクトの共有も）', () => {
    const shared = { give: ['e1', 'e2'] };
    const out = new Set<string>();
    // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
    collectGives([{ then: [shared, { give: 'e3' }] }, { else: [shared] }, { take: 'e9' }], out);
    expect([...out].sort()).toEqual(['e1', 'e2', 'e3']);
  });
});

describe('調べる間に背景を動かせない場所', () => {
  test('パート 0x12 の背景 0x73 の場所に、編とフラグ 0x45 の条件を付ける（同じ組のほかの編の場所にも）', () => {
    const ctx = (part: number, places: { id: number; bg: number }[]) => ({
      part,
      inv: { places },
      placeId: (n: number) => `p17_place${n}`,
      fname: (g: number, n: number) => `f_${g}_${n}`,
    });
    const head = {
      ctx: ctx(0x11, [{ id: 22, bg: 0x73 }]),
      part: {
        places: {
          p17_place22: { name: '駐車場', background: 'bg115', enter: [] },
          p17_place6: { name: '留置所', background: 'bg30' },
        } as Record<string, Record<string, unknown>>,
      },
    };
    const next = {
      ctx: ctx(0x12, [
        { id: 22, bg: 0x73 },
        { id: 6, bg: 30 },
      ]),
      part: {},
    };
    markNoScroll([head, next], 'part');
    expect(Object.keys(head.part.places.p17_place22!)).toEqual([
      'name',
      'background',
      'examineScroll',
      'enter',
    ]);
    expect(head.part.places.p17_place22!.examineScroll).toBe('not (part == 1 and f_0_69)');
    expect(head.part.places.p17_place6!.examineScroll).toBeUndefined();
  });
});
