// サイコ・ロック（逆転裁判2・3）の変換（ops23.ts の正解の表・section-branch.ts の lockDemand・話題のフラグ）のテスト。
import { describe, expect, test } from 'bun:test';
import { Context, Shared } from '../context.ts';
import { otherCond } from '../invest23.ts';
import { newMemory } from '../ops.ts';
import { answerCandidates } from '../ops23.ts';
import { lockDemand } from '../section-branch.ts';
import type { Entry, Op, Step, Tables } from '../types.ts';

const tables = {
  game: 'aa3',
  names: [],
  chars: {},
  evidence: [],
  evidenceStart: [],
  sounds: new Map(),
  blipKinds: [],
  court: { common_wrong: [], common_item: 84, parts: [] },
} as unknown as Tables;

const op = (code: number, name: string, args: number[]): Op =>
  ({ at: 0, op: code, name, args }) as Op;

// 逆転裁判3 の第 5 話 070 §121〜§122・§228 の形:
//   §0 最初の要求の正解を「どれも外れ」（0）にして、写真の一点を指す
//   §1 挑戦中のつきつけ（82 → 21）
//   §2 一点を当てたとき: 正解を 147（真宵の人物ファイル）に変えて §1 へ
const entry: Entry = {
  entry: 70,
  lang: 'ja',
  sections: 3,
  labels: {},
  body: [
    { section: 0, ops: [op(96, 'nop96', [1, 0, 132, 131]), op(21, 'player_turn', [])] },
    { section: 1, ops: [op(82, 'unused82', [3]), op(21, 'player_turn', [])] },
    {
      section: 2,
      ops: [op(96, 'nop96', [1, 147, 132, 131]), op(44, 'jump_after', [1 + 128])],
    },
  ],
};

describe('挑戦中のつきつけの正解の表（ロックの枠の +0x18〜+0x20。最後に実行した 96 / 97）', () => {
  test('飛んでくる区画の 96 と、前で最も近い 96 の区画が候補になる', () => {
    const ctx = new Context(tables, entry, { pfx: 'p35_', gpfx: 'p34_' });
    expect(answerCandidates(ctx, 1)).toEqual([0, 2]);
    // 96 のある区画そのものなら、その区画だけ
    expect(answerCandidates(ctx, 2)).toEqual([2]);
  });

  test('候補が 2 つなら、どちらを通ったかで正解を分け、章の法廷記録に無い番号（0）は書かない', () => {
    const shared = new Shared();
    shared.chapterRecords.add(147);
    const ctx = new Context(tables, entry, { pfx: 'p35_', gpfx: 'p34_', shared });
    const go = (t: number): Step[] => [{ goto: `s${t}` }];
    const mem = { ...newMemory(), lockPresent: true };
    const d = lockDemand(ctx, 1, null, mem, go) as {
      present: Record<string, Step[]>;
      wrong: Step[];
    };
    expect(Object.keys(d.present)).toEqual(['e147']);
    // §0 を最後に通ったとき（一点を外した）は 147 も外れ、§2 を通ったとき（当てた）は正解
    expect(d.present.e147).toEqual([
      // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
      { if: 'p34_lockans == 0', then: [{ goto: 's3' }], else: [{ goto: 's4' }] },
    ]);
    // 外れはどちらでも同じ区画なので、分けない
    expect(d.wrong).toEqual([{ goto: 's3' }]);
  });
});

describe('話題の項目のフラグ（talk_項目）', () => {
  test('初期値は、どこで最初に読んでも表の active', () => {
    const inv = { part: 17, talk: [{ id: 16, place: 21, person: 30, active: true, topics: [] }] };
    const ctx = new Context(tables, entry, { pfx: 'p34_', inv: inv as never });
    // 着いたときの条件（_other）で先に読んでも false にならない
    expect(otherCond(ctx, ['talk[16][3] eq 1 = True'])).toEqual(['p34_talk_16']);
    expect(ctx.flags.get('p34_talk_16')).toBe(true);
    expect(ctx.talkFlag(3)).toBe('p34_talk_3');
    expect(ctx.flags.get('p34_talk_3')).toBe(false);
  });
});
