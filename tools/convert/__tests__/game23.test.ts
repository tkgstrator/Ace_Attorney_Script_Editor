// 逆転裁判2・3 の変換（invest23.ts・testimony-split.ts）の、表に依らない関数のテスト。
import { describe, expect, test } from 'bun:test';
import { Context } from '../context.ts';
import { frameRowStep, frameTabs, otherCond, presentChain23 } from '../invest23.ts';
import { flagPress } from '../testimony-split.ts';
import type { Entry, Op, Step, Tables } from '../types.ts';

const tables = {
  game: 'aa2',
  names: [],
  chars: {},
  evidence: [],
  evidenceStart: [],
  sounds: new Map(),
  blipKinds: [],
  court: { common_wrong: [], common_item: 44, parts: [] },
} as unknown as Tables;
const entry: Entry = {
  entry: 4,
  lang: 'ja',
  sections: 1,
  labels: {},
  body: [{ section: 0, ops: [] }],
};
const sec = (section: number) => ({ raw: section + 0x80, script: 'story', section });
const row = (state: number | null, item: number | null, section: number, def: number) => ({
  place: 7,
  state,
  item,
  record: 'evidence',
  person: 19,
  section: sec(section),
  default: sec(def),
});

describe('つきつけの表（ARM9 A2GJ 0x020310d4）', () => {
  const rows = [
    row(0, null, 138, 138),
    row(null, 42, 146, 147),
    row(3, 43, 157, 147),
    row(4, 40, 162, 161),
  ];
  const ctx = new Context(tables, entry, {
    pfx: 'p2_',
    inv: { part: 2, present: { entries: rows } } as never,
  });
  const block = (s: number): Step[] => [{ goto: `s${s}` }];

  test('状態の合う、番号の合う最初の行。無ければ状態の合う、番号の合わない最後の行の既定', () => {
    const steps = presentChain23(ctx, 7, rows, 44, 'evidence', block);
    // 人物 19 のとき: 状態 0 → 138、状態 4 → 161（番号 40 の行の既定）、状態 3 → 147、ほか → 147
    expect(JSON.stringify(steps)).toContain('"if":"p2_pstate_7 == 0","then":[{"goto":"s138"}]');
    expect(JSON.stringify(steps)).toContain('"if":"p2_pstate_7 == 4","then":[{"goto":"s161"}]');
    expect(JSON.stringify(steps)).toContain('"if":"p2_pstate_7 == 3","then":[{"goto":"s147"}]');
  });

  test('番号の合う行は、状態が合えばその区画', () => {
    const steps = presentChain23(ctx, 7, rows, 40, 'evidence', block);
    expect(JSON.stringify(steps)).toContain('"if":"p2_pstate_7 == 4","then":[{"goto":"s162"}]');
  });
});

describe('毎フレームの処理（every_frame）', () => {
  const ctx = new Context(tables, entry, { pfx: 'p9_' });
  const pl = {
    id: 15,
    every_frame: [
      {
        when: { '0:0xed': 1 },
        do: [{ set_flag: '0:0xed', value: 0 }, { examine: null }, { examine: '0xa' }],
      },
      { when: { '0:0x14': 0 }, do: [{ store: 'game+0x84', value: 4 }, { arrive_again: true }] },
    ],
  };

  test('調べる表を替える行は、表の番号を数のフラグに入れる', () => {
    const tabs = frameTabs(ctx, pl)!;
    expect(tabs.flag).toBe('p9_exam_15');
    expect(frameRowStep(ctx, pl.every_frame[0]!, tabs)).toEqual([
      // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
      { if: 'f_0_237', then: [{ set: { f_0_237: false } }, { set: { p9_exam_15: 0 } }] },
    ]);
  });

  test('今の場所を替えて着き直す行は、その場所へ移る', () => {
    expect(frameRowStep(ctx, pl.every_frame[1]!, null)).toEqual([
      {
        if: 'not f_0_20',
        // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
        then: [{ set: { p9_menu_return: false } }, { investigate: 'p9_place4' }],
      },
    ]);
  });

  test('道の条件の _other（話題の表を使うか）', () => {
    expect(otherCond(ctx, ['talk[5][3] eq 1 = True'])).toEqual(['p9_talk_5']);
    expect(otherCond(ctx, ['talk[5][3] ne 1 = True'])).toEqual(['not p9_talk_5']);
    expect(otherCond(ctx, ['talk[16][3] eq 0 = False'])).toEqual(['p9_talk_16']);
    expect(otherCond(ctx, ['ctx+0x4a ne 227 = False'])).toBeNull();
  });
});

describe('フラグで行き先の変わるゆさぶり', () => {
  test('逆転裁判2 の形: 1 つ目の 15 の後の 53 が 2 つ目の 15 を飛び越す', () => {
    const ops = [
      { at: 0, op: 0, name: 'nop', args: [] },
      { at: 2, op: 15, name: 'press', args: [161, 0] },
      { at: 8, op: 53, name: 'if_flag', args: [0x4000, 20], target: { section: null, offset: 20 } },
      { at: 14, op: 15, name: 'press', args: [162, 0] },
      { at: 106, op: 21, name: 'player_turn', args: [] },
    ] as Op[];
    // フラグ 0x40 が 0 なら飛び越す（1 つ目の §33）、1 なら 2 つ目（§34）
    expect(flagPress(ops as never)).toEqual({ a: 34, b: 33, flag: 0x40, want: false, jumps: [8] });
  });
});
