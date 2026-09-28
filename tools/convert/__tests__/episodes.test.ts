// 話ごとの項目の並び（episodes.ts）のテスト。根拠は ROM の話の選択（episodes.ts の先頭の説明）。
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EPISODE_TABLE, episode, episodeOfItem, episodes } from '../episodes.ts';
import { GAMES, type GameKey } from '../tables.ts';

const even = (a: number, b: number) => Array.from({ length: (b - a) / 2 + 1 }, (_, i) => a + 2 * i);

describe('蘇る逆転（話の選択 0x0204ba24: パート 0 / 1 / 5 / 0xb / 0x11）', () => {
  test('各話の項目', () => {
    expect(episodes('aa1').map((e) => e.items)).toEqual([
      [0],
      even(2, 8),
      even(10, 20),
      even(22, 32),
      even(34, 68),
    ]);
  });
  test('第 3 話は 10 月 20 日の法廷（項目 20）まで、第 4 話は項目 22 から', () => {
    expect(episodeOfItem('aa1', 18)).toBe(3);
    expect(episodeOfItem('aa1', 20)).toBe(3);
    expect(episodeOfItem('aa1', 21)).toBe(3);
    expect(episodeOfItem('aa1', 22)).toBe(4);
  });
  test('話の最初の項目 = 2 × 話の選択のパート', () => {
    expect(EPISODE_TABLE.aa1.starts).toEqual([0, 1, 5, 0xb, 0x11].map((p) => 2 * p));
  });
  test('パートでない項目（070 の 3D の台詞・072 の共通の台本）はどの話でもない', () => {
    expect(episodeOfItem('aa1', 70)).toBeUndefined();
    expect(episodeOfItem('aa1', 72)).toBeUndefined();
  });
});

describe('逆転裁判2（話の選択 0x02048010: パート 0 / 2 / 8 / 0xe）', () => {
  test('各話の項目', () => {
    expect(episodes('aa2').map((e) => e.items)).toEqual([
      even(0, 2),
      even(4, 14),
      even(16, 26),
      even(28, 42),
    ]);
    expect(EPISODE_TABLE.aa2.starts).toEqual([0, 2, 8, 0xe].map((p) => 2 * p));
  });
});

describe('逆転裁判3（話の選択 0x02042374: パート 0 / 2 / 7 / 0xc / 0xe）', () => {
  // T（0x020a3cc0、パート → 項目 / 2）
  const T = [0, 1, 3, 5, 7, 10, 11, 13, 15, 17, 20, 21, 23, 25, 27, 28, 30, 31, 32, 34, 36, 38, 39];
  test('各話の最初の項目 = 2 × T[パート]', () => {
    expect(EPISODE_TABLE.aa3.starts).toEqual([0, 2, 7, 0xc, 0xe].map((p) => 2 * T[p]!));
  });
  test('各話の項目（パートの途中の項目も含む）', () => {
    expect(episodes('aa3').map((e) => e.items)).toEqual([
      even(0, 4),
      even(6, 24),
      even(26, 44),
      even(46, 52),
      even(54, 82),
    ]);
  });
  const court = join(GAMES.aa3.dir, 'tables/court.json');
  test.skipIf(!existsSync(court))('court.json の part_starts と同じ', () => {
    const starts = JSON.parse(readFileSync(court, 'utf8')).part_starts as number[];
    expect(starts).toEqual(T.map((t) => 2 * t));
  });
});

test('題名の数と話の数が合う・話の番号で引ける', () => {
  for (const g of Object.keys(EPISODE_TABLE) as GameKey[]) {
    const t = EPISODE_TABLE[g];
    expect(t.titles.length).toBe(t.starts.length);
    expect(episode(g, 1)?.items[0]).toBe(0);
    expect(episode(g, t.starts.length + 1)).toBeUndefined();
  }
});
