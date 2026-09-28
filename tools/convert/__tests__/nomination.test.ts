// 人物の指名（116 10 n、第 5 話）の結果の区画を、作りものの項目と（あれば）元の台本で確かめる。
// 056 §40 の指名で、続く話題の区画（§44「巌徒海慈」）まで結果の選択肢にして、第 5 話の最後の探偵パートが詰んでいた。
import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Context } from '../context.ts';
import { nominationResults } from '../flow.ts';
import { convertOps } from '../section.ts';
import { EXTRACTED, loadEntry } from '../tables.ts';
import type { Entry, Op, Tables } from '../types.ts';

let at = 0;
const c = (op: number, ...args: number[]): Op => ({ at: (at += 2), op, name: `op${op}`, args });
const t = (text: string): Op => ({ at: (at += 2), op: 'text', text });
const jump = (s: number): Op => ({ ...c(10, s + 128), targets: [{ section: s, offset: 0 }] }) as Op;
const tables = {
  names: [],
  chars: {},
  evidence: [],
  evidenceStart: [],
  sounds: new Map(),
  blipKinds: [],
  court: { common_wrong: [], common_item: 72, parts: [] },
} as Tables;
const entry = (body: Op[][]): Entry => ({
  entry: 0,
  lang: 'ja',
  sections: body.length,
  labels: {},
  body: body.map((ops, section) => ({ section, ops })),
});

/** §0 で指名し、§1 から先に結果の区画を並べた項目 */
const nominate = (...rest: Op[][]) =>
  entry([[c(0), t('だれ?'), c(116, 10, 4), c(21), c(13)], ...rest]);

describe('人物の指名の結果', () => {
  test('法廷: 次の区画が外れ（元の区画へ戻る）、その次が正解', () => {
    const e = nominate(
      [c(0), t('外れ'), jump(0), c(13)],
      [c(0), t('正解'), c(13)],
      [c(0), t('続き'), c(21), c(13)],
    );
    expect(nominationResults(e, 0)).toEqual([1, 2]);
  });

  test('探偵パート（056 §40）: 外れが次の区画へ落ちていくなら、落ちなくなった区画の次が正解。その後の話題の区画は含めない', () => {
    const e = nominate(
      [c(0), t('外れ 1'), c(13)], // §41: そのまま §42 へ
      [c(0), t('外れ 2'), c(21), c(13)], // §42: 探偵メニューへ
      [c(0), t('正解'), c(55, 7, 1), c(21), c(13)], // §43: 話題を切り替える
      [c(0), t('話題「巌徒海慈」'), c(21), c(13)], // §44: 話題の区画
    );
    expect(nominationResults(e, 0)).toEqual([1, 3]);
    const steps = convertOps(new Context(tables, e), 0, e.body[0]!.ops, {
      gotoSteps: (s) => [{ goto: `s${s}` }],
    });
    expect(steps.at(-1)).toEqual({
      choice: [
        { text: '（外れ 1）', then: [{ goto: 's1' }] },
        { text: '（正解）', then: [{ goto: 's3' }] },
      ],
    });
  });

  test('結果の区画が無ければ空', () => {
    expect(nominationResults(entry([[c(0), c(116, 10, 4), c(21)]]), 0)).toEqual([]);
  });
});

const ready = [50, 56, 64, 66].every((n) => existsSync(join(EXTRACTED, `script/json/0${n}.json`)));
describe.skipIf(!ready)('第 5 話の指名（元の台本）', () => {
  test('6 か所とも [外れ, 正解] になる', () => {
    const at = (n: number, s: number) => nominationResults(loadEntry(n), s);
    expect(at(50, 54)).toEqual([55, 56]);
    expect(at(56, 40)).toEqual([41, 43]);
    expect(at(64, 2)).toEqual([3, 4]);
    expect(at(64, 39)).toEqual([40, 41]);
    expect(at(64, 57)).toEqual([58, 59]);
    expect(at(66, 59)).toEqual([60, 61]);
  });
});
