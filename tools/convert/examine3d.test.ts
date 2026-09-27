// 3D で詳しく調べる（examine3d.json → 証拠品の examine）・パートの移り方（106）・使われていない区画の除き方を、
// 作りものの項目と表で確かめる。
import { describe, expect, test } from 'bun:test';
import { Context } from './context.ts';
import { buildExamine } from './examine3d-build.ts';
import { convertExamine, examineWaitAt, prepareExamine, type Examine3d } from './examine3d.ts';
import { pruneUnusedScenes } from './prune.ts';
import { convertOps } from './section.ts';
import type { Entry, Op, Tables } from './types.ts';

let at = 0;
const c = (op: number, ...args: number[]): Op => ({ at: (at += 2), op, name: `op${op}`, args });
const t = (text: string): Op => ({ at: (at += 2), op: 'text', text });
const entry = (n: number, body: Op[][]): Entry => ({
  entry: n, lang: 'ja', sections: body.length, labels: {},
  body: body.map((ops, section) => ({ section, ops })),
});

const x3d: Examine3d = {
  evidence: { 5: 0 },
  objects: [{ id: 0, spots: [{ result: 0 }, { result: 1 }] }, { id: 1, spots: [{ result: 1 }] }],
  results: [
    { id: 0, paths: [{ parts: [0], when: {}, set_flags: { '0:1': 1 }, section: { raw: 131, script: 'story', section: 3 }, next_object: 1 }] },
    { id: 1, paths: [{ parts: [0], when: {}, set_flags: {}, section: { raw: 128, script: '070', section: 0 }, next_object: null }] },
  ],
  story_modes: [{ mode: 0x14, opened_at: { section: 1 }, events: [{ on: 'close', section: { section: 2 } }, { on: 'auto_close', flag: '0:9' }] }],
};
const tables: Tables = {
  names: [{ id: 0, text: { ja: '', en: '' } }, { id: 2, text: { ja: 'ナルホド', en: 'Phoenix' } }],
  chars: { 2: { name: '成歩堂 龍一', name_id: 2 } },
  evidence: [], evidenceStart: [], sounds: new Map(), blipKinds: [],
  court: { common_wrong: [], common_item: 72, parts: [] },
  examine3d: x3d,
};
// 話の台本: §1 で証拠品 5 を加えて 3D の画面を開いて待つ、§2 = 閉じたとき、§3 = 調べた結果（フラグ 0:9 を立てる）
const story = entry(0, [
  [c(0), c(13)],
  [c(0), c(23, 5), c(14, 2 << 8), t('調べてみよう。'), c(2), c(116, 8, 46), c(28, 1), c(21), c(13)],
  [c(0), c(14, 2 << 8), t('閉じた。'), c(2), c(36), c(13)],
  [c(0), c(16, 1 << 15 | 9), c(14, 2 << 8), t('ケータイの画面だ。'), c(2), c(21), c(13)],
]);
// 項目 070: §0 = フラグ 31 で §1 / §2 に分かれる
const item070 = entry(70, [
  [c(0), { at: (at += 2), op: 42, name: 'testimony_jump', args: [31, 129, 130], targets: [{ section: 1, offset: 0 }, { section: 2, offset: 0 }] }, c(13)],
  [c(0), c(14, 2 << 8), t('いっしょに見た。'), c(2), c(21), c(13)],
  [c(0), c(14, 2 << 8), t('ひとりで見た。'), c(2), c(21), c(13)],
]);

describe('3D で詳しく調べる', () => {
  const ctx = new Context(tables, story);
  prepareExamine(ctx);
  convertExamine(ctx);

  test('結果の区画（§3）とモードの区画（§2）はシーンにせず取り込む。法廷で開いて待つ所は正解のないつきつけ', () => {
    expect([...ctx.consumed].sort()).toEqual([2, 3]);
    expect(examineWaitAt(ctx, 1)).toBe(true);
    const steps = convertOps(ctx, 1, story.body[1]!.ops);
    expect(steps.at(-1)).toEqual({ demand: '（法廷記録の証拠品を、詳しく調べてみよう）', present: {}, wrong: [] });
  });

  test('面の結果ごとの examine。続けて見せる物の面は開いた後だけ、同じ台詞の結果はまとめる', () => {
    const ex = buildExamine(tables, [ctx], [5], item070, null).examine.get(5)!;
    expect(ex.map(e => e.spot)).toEqual(['（ケータイの画面だ。）', '（ひとりで見た。）']);
    // 結果: フラグと「開いた」印 → §3 → フラグ 0:9 が立つので、閉じたとき（§2）も続ける
    const first = JSON.stringify(ex[0]!.then);
    expect(ex[0]!.then[0]).toEqual({ set: { f_0_1: true, x3d_open1: true } });
    expect(first.indexOf('ケータイの画面だ。')).toBeLessThan(first.indexOf('閉じた。'));
    // 項目 070 の分かれ道は if にする
    expect(ex[1]!.then[0]).toMatchObject({ if: 'f_0_31' });
    expect(JSON.stringify(ex[1]!.then)).toContain('いっしょに見た。');
  });
});

describe('ルミノール', () => {
  test('背景が合う場所に、試薬を持っていてまだ見つけていないときだけの調べる所を作る（見つけるとフラグ、070 の台詞）', () => {
    const t2: Tables = { ...tables, examine3d: { ...x3d, luminol: [{ index: 6, bg: 117, scrolled: false, spots: [
      { x: 80, y: 72, w: 24, h: 16, flag: 20, section: { raw: 129, script: '070', section: 1 } }] }] } };
    const ctx = new Context(t2, story, { inv: { part: 24, places: [{ id: 27, bg: 117 }, { id: 26, bg: 118 }] } });
    const { luminol } = buildExamine(t2, [ctx], [], item070, null);
    expect([...luminol.keys()]).toEqual(['place27']);
    const [e] = luminol.get('place27')!;
    expect(e).toMatchObject({ area: [80, 72, 24, 16], when: 'has(e144) and not f_0_20' });
    expect(e!.then[0]).toEqual({ set: { f_0_20: true } });
    expect(JSON.stringify(e!.then)).toContain('いっしょに見た。');
  });
});

describe('パートの移り方と、使われていない区画', () => {
  test('106 は次の命令の番号のパートへ移る', () => {
    const e = entry(38, [[c(0), c(16, 1 << 15 | 33), c(106), c(20), c(13)]]);
    const ctx = new Context(tables, e);
    ctx.toPart = p => [{ goto: `part${p}` }];
    expect(convertOps(ctx, 0, e.body[0]!.ops).at(-1)).toEqual({ goto: 'part20' });
  });

  test('表からも台本からも行けず、どこからも移動しない区画のシーンは除く（行ける区画は残す）', () => {
    const e = entry(4, [[c(0), c(13)], [c(0), t('あ'), c(2), c(36), c(13)], [c(0), t('古い版'), c(2), c(36), c(13)]]);
    const ctx = new Context(tables, e);
    const scenario = { start: { scene: 's000' }, parts: [{ scenes: { s000: [{ goto: 's001' }], s001: [{ end: true }], s002: [{ end: true }] } }] };
    expect(pruneUnusedScenes(scenario, [ctx])).toBe(1);
    expect(Object.keys(scenario.parts[0]!.scenes)).toEqual(['s000', 's001']);
  });
});
