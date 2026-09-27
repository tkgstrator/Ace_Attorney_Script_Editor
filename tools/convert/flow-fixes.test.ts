// 流れの変換の直し（53 のブロックの中の「次の区画」・フラグで行き先の変わるゆさぶり・第 5 話の法廷の日の始めのフラグ）を、
// 作りものの項目で確かめる。
import { describe, expect, test } from 'bun:test';
import { Context } from './context.ts';
import { dayStartFlags } from './investigation.ts';
import { convertOps } from './section.ts';
import { flagPress } from './testimony.ts';
import type { Entry, Op, Tables } from './types.ts';

let at = 0;
const c = (op: number, ...args: number[]): Op => ({ at: (at += 2), op, name: `op${op}`, args });
const tables: Tables = {
  names: [{ id: 0, text: { ja: '', en: '' } }], chars: {}, evidence: [], evidenceStart: [], sounds: new Map(), blipKinds: [],
  court: { common_wrong: [], common_item: 72, parts: [] },
};
const entry = (body: Op[][]): Entry => ({ entry: 0, lang: 'ja', sections: body.length, labels: {}, body: body.map((ops, section) => ({ section, ops })) });

describe('流れの直し', () => {
  test('53 で飛び越すブロックの中の 44（次の区画）は、ブロックの最後の移動になる（038 §17 の §19 への道）', () => {
    // §0: フラグ 41 が立っていなければ終わりへ、立っていれば次の区画 = §2。その後 end（既定は §1）
    const nop = c(0);
    const jump = { ...c(53, 41 << 8, 0), target: { section: null, offset: 0 } } as Op & { target: { offset: number } };
    const next = { ...c(44, 130), targets: [{ section: 2, offset: 0 }] } as Op;
    const end = c(13);
    jump.target.offset = end.at;
    const e = entry([[nop, jump, next, end], [c(0), c(13)], [c(0), c(13)]]);
    const ctx = new Context(tables, e);
    const steps = convertOps(ctx, 0, e.body[0]!.ops, { gotoSteps: t => [{ goto: `s${t}` }] });
    expect(steps).toEqual([{ if: 'f_0_41', then: [{ goto: 's2' }] }, { goto: 's1' }]);
  });

  test('文の区画のゆさぶり先が 2 つあり、フラグで 2 つ目へ飛ぶ形（042 §12）', () => {
    const second = { ...c(15, 159, 1), targets: [{ section: 31, offset: 0 }] } as Op;
    const ops = [c(0), { ...c(53, 50 << 8 | 1, 0), target: { section: null, offset: 0 } } as Op,
      { ...c(15, 158, 0), targets: [{ section: 30, offset: 0 }] } as Op, c(53, 50 << 8, 0), second, c(21)];
    (ops[1] as { target: { offset: number } }).target.offset = second.at;
    expect(flagPress(ops)).toMatchObject({ a: 30, b: 31, flag: 50, want: true });
    expect(flagPress([c(0), { ...c(15, 158, 0), targets: [{ section: 30, offset: 0 }] } as Op, c(21)])).toBeNull();
  });

  test('第 5 話の日の始めは、台本のフラグを戻し、法廷の日は ARM9 の決まったフラグを入れる（茜が一緒か = 0x1f は残す）', () => {
    const flags = ['f_0_42', 'f_0_31', 'f_2_5', 'p17_place'];
    expect(dayStartFlags(0x13, flags)).toEqual({ f_0_42: false, f_0_2: false, f_0_33: false, f_0_34: false, f_0_31: true });
    expect(dayStartFlags(0x16, flags)).toEqual({ f_0_42: false });
    expect(dayStartFlags(0x14, flags)).toBeNull();
  });
});
