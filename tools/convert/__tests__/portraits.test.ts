// 立ち絵の確かめ（portraits.ts）と、2・3 の人物ファイルの人物（context.ts の profile）のテスト。
import { describe, expect, test } from 'bun:test';
import { Context } from '../context.ts';
import { collectUses, findMismatches, speakerTable } from '../portraits.ts';
import { slug } from '../tables.ts';
import type { Entry, Tables } from '../types.ts';

describe('立ち絵の確かめ', () => {
  const chapter = {
    player: 'phoenix',
    characters: {
      phoenix: { name: 'ナルホド' },
      pearl: { name: 'ハルミ' },
      larry: { name: 'ヤハリ' },
    },
    scenes: {
      s1: [
        { show: 'pearl', talk: 425, idle: 426 },
        { pearl: 'こんにちは[show pearl 427 426]' },
        { say: 'phoenix', text: 'やあ' },
        { show: 'larry', talk: 423 },
        { larry: 'よう' },
      ],
    },
  };
  const uses = collectUses(chapter);

  test('show・文中の show・台詞の話し手を集める', () => {
    expect(uses.filter((u) => !u.speaker).map((u) => `${u.id}:${u.anim}`)).toEqual([
      'pearl:425',
      'pearl:426',
      'pearl:427',
      'pearl:426',
      'larry:423',
    ]);
    expect(uses.filter((u) => u.speaker).map((u) => `${u.speaker}>${u.id}:${u.anim}`)).toEqual([
      'pearl>pearl:427',
      'phoenix>pearl:427',
      'larry>larry:423',
    ]);
  });

  const tag = (id: string) =>
    (chapter.characters as Record<string, { name: string }>)[id]?.name ?? null;
  const charTag = (c: number) => ({ 29: 'ヤハリ', 30: 'ハルミ' })[c] ?? null;

  test('動きの番号の表がずれて、1 つの絵のファイルを 2 人に出していれば食い違い', () => {
    // 3 の動きの表を 49 ずれた所から読んでいたときの形（ファイル 083 がヤハリと春美の両方に出る）
    const shifted = {
      '423': { file: '083', char: 29 },
      '425': { file: '083', char: 30 },
      '426': { file: '083', char: 30 },
      '427': { file: '084', char: 30 },
    };
    const ms = findMismatches(uses, shifted, tag, charTag);
    expect(ms.map((m) => [m.kind, m.file, m.tags.sort().join('・')])).toEqual([
      ['file', '083', 'ハルミ・ヤハリ'],
    ]);
    const ok = { ...shifted, '423': { file: '077', char: 29 } };
    expect(findMismatches(uses, ok, tag, charTag)).toEqual([]);
  });

  test('台本で別の人物が使う動きを出していれば食い違い', () => {
    const anims = {
      '423': { file: '077', char: 30 },
      '425': { file: '083', char: 30 },
      '426': { file: '083', char: 30 },
      '427': { file: '084', char: 30 },
    };
    const ms = findMismatches(uses, anims, tag, charTag);
    expect(ms).toEqual([
      { kind: 'anim', anim: 423, file: '077', tags: ['ヤハリ', 'ハルミ'], count: 1 },
    ]);
  });

  test('話し手 × 立ち絵の一覧（主人公の台詞は除く）', () => {
    expect([...speakerTable(uses, tag, 'phoenix')]).toEqual([
      ['ハルミ\tハルミ', 1],
      ['ヤハリ\tヤハリ', 1],
    ]);
  });
});

describe('2・3 の人物ファイルの人物', () => {
  const names = [
    { id: 4, text: { ja: 'マヨイ', en: 'Maya' } },
    { id: 15, text: { ja: 'ヤハリ', en: 'Butz' } },
    { id: 29, text: { ja: 'ヤハリ', en: 'Butz' } },
  ];
  const tables = {
    game: 'aa3',
    names,
    chars: {},
    evidence: [],
    evidenceStart: [],
    sounds: new Map(),
    blipKinds: [],
    court: { common_wrong: [], common_item: 84, parts: [] },
    recordText: {
      '146': { name: '綾里 真宵（19）', desc: '説明 1' },
      '147': { name: '綾里 真宵（19）', desc: '説明 2' },
      '159': { name: '矢張 政志（25）', desc: '' },
      '31': { name: '被害者', desc: '' },
    },
    profiles: {
      '146': { name_image: 19, name_en: 'Maya Fey', name_id: 4 },
      '147': { name_image: 19, name_en: 'Maya Fey', name_id: 4 },
      '159': { name_image: 26, name_en: 'Larry Butz', name_id: 15 },
      '31': { name_image: 27, name_en: 'Kane Bullard', name_id: null },
    },
  } as unknown as Tables;
  const entry: Entry = { entry: 54, lang: 'ja', sections: 1, labels: {}, body: [] };

  test('同じ人物の人物ファイルは、話し手と同じ ID にまとめる', () => {
    const ctx = new Context(tables, entry);
    expect(ctx.profile(146)).toBe('maya');
    expect(ctx.profile(147)).toBe('maya');
    expect(ctx.speaker(4)).toBe('maya');
    expect(ctx.characters.get('maya')?.profile).toMatchObject({ name: '綾里 真宵', age: 19 });
  });

  test('同じ名札の番号がいくつもあれば、名札の ID を先に取った番号にまとめる', () => {
    const ctx = new Context(tables, entry);
    expect(ctx.speaker(29)).toBe('butz');
    expect(ctx.profile(159)).toBe('butz');
  });

  test('台詞の無い人物は英語の名前から ID を作る', () => {
    const ctx = new Context(tables, entry);
    expect(ctx.profile(31)).toBe('kane_bullard');
    expect(slug('Desirée')).toBe('desiree');
  });
});
