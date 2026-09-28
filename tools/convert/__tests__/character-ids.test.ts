// 人物 ID の対応表（character-ids.json）と、表から人物 ID を決める所（people.ts）のテスト。
import { describe, expect, test } from 'bun:test';
import { ID_PATTERN, type IdTable, loadIdTables } from '../character-ids.ts';
import { Context } from '../context.ts';
import type { Entry, Tables } from '../types.ts';

describe('character-ids.json', () => {
  const tables = loadIdTables();

  test('3 作とも、名前・人物・人物ファイルの表がある', () => {
    expect(Object.keys(tables).sort()).toEqual(['aa1', 'aa2', 'aa3']);
    for (const t of Object.values(tables))
      for (const k of ['names', 'chars', 'profiles'] as const) expect(typeof t[k]).toBe('object');
  });

  test('ID は英小文字・数字・_ で、ROM の番号（c12、r120、名前_15）や人物ファイルの版（_v2）の形を使わない', () => {
    for (const [game, t] of Object.entries(tables))
      for (const [kind, m] of Object.entries(t))
        for (const [n, id] of Object.entries(m as Record<string, string>)) {
          const where = `${game}.${kind}.${n} = ${id}`;
          expect(ID_PATTERN.test(id), where).toBe(true);
          expect(/^[cr]\d+$/.test(id) || /_\d+$/.test(id) || /_v\d+$/.test(id), where).toBe(false);
          expect(/^\d+$/.test(n), where).toBe(true);
        }
  });

  test('同じ人物は 3 作で同じ ID', () => {
    for (const id of ['phoenix', 'maya', 'edgeworth', 'gumshoe', 'judge', 'payne', 'mia'])
      for (const t of Object.values(tables)) expect(Object.values(t.names)).toContain(id);
    // 狩魔 冥（2・3）と狩魔 豪（1 の名札、2 の人物の絵、3 の人物ファイル）は別の人物
    expect(tables.aa2.names['15']).toBe('von_karma');
    expect(tables.aa3.names['34']).toBe('von_karma');
    expect(tables.aa1.names['33']).toBe('manfred_von_karma');
    expect(tables.aa2.chars['14']).toBe('manfred_von_karma');
    expect(tables.aa3.profiles['192']).toBe('manfred_von_karma');
  });
});

describe('表から人物 ID を決める', () => {
  const ids: IdTable = {
    names: { '2': 'phoenix', '5': 'mia_channeled', '7': 'mia' },
    chars: { '9': 'mia_closeup' },
    profiles: { '3': 'cindy_stone', '16': 'mia', '17': 'mia' },
  };
  const tables = {
    game: 'aa1',
    names: [
      { id: 2, text: { ja: 'ナルホド', en: 'Phoenix' } },
      { id: 5, text: { ja: 'チヒロ', en: 'Mia' } },
      { id: 7, text: { ja: 'チヒロ', en: 'Mia' } },
      { id: 8, text: { ja: 'サイバンカン', en: 'Judge' } },
    ],
    chars: {
      '5': { name: null, name_id: 5 },
      '7': { name: null, name_id: 7 },
      '9': { name: null, name_id: 7 },
    },
    evidence: [],
    evidenceStart: [],
    sounds: new Map(),
    blipKinds: [0, 0, 0, 0, 0, 1, 0, 1],
    court: { common_wrong: [], common_item: 72, parts: [] },
    ids,
  } as unknown as Tables;
  const entry: Entry = { entry: 0, lang: 'ja', sections: 0, labels: {}, body: [] };

  test('名前・人物の番号は表の ID。表に無ければ警告して番号入りの仮の ID', () => {
    const ctx = new Context(tables, entry);
    expect(ctx.speaker(7)).toBe('mia');
    expect(ctx.character(5)).toBe('mia_channeled');
    expect(ctx.character(9)).toBe('mia_closeup');
    expect(ctx.characters.get('mia_closeup')?.name).toBe('チヒロ');
    expect(ctx.shared.idWarnings.size).toBe(0);
    expect(ctx.speaker(8)).toBe('judge');
    expect([...ctx.shared.idWarnings]).toEqual([
      '人物 ID の表（tools/convert/character-ids.json）に無い名前の番号: 8',
    ]);
  });

  test('人物ファイルは話し手にまとめ、同じ人物の人物ファイルが章にいくつもあれば _v2 から', () => {
    const ctx = new Context(tables, entry);
    for (const r of [3, 16, 17]) {
      ctx.shared.chapterRecords.add(r);
      ctx.shared.profileRecords.add(r);
    }
    expect(ctx.profile(17)).toBe('mia_v2');
    expect(ctx.profile(16)).toBe('mia');
    // 話し手の名札と文字送りの音は、人物ファイルの氏名より先に決める
    expect(ctx.characters.get('mia')).toMatchObject({ name: 'チヒロ', blip: 'female' });
    expect(ctx.profile(3)).toBe('cindy_stone');
    expect(ctx.shared.idWarnings.size).toBe(0);
  });
});
