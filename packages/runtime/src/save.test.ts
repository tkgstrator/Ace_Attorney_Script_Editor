// セーブデータの読み込み時の確かめ
import { describe, expect, it } from 'vitest';
import { SaveError, parseSnapshot } from './save.ts';

const ok = { version: 1, scenario: 'ep1', state: { scene: 's' } };

describe('parseSnapshot', () => {
  it('セーブデータの形なら、そのまま返す', () => {
    expect(parseSnapshot(ok, 'ep1')).toBe(ok);
    expect(parseSnapshot(ok)).toBe(ok);
  });
  it('形が違う・別の章のものはエラー', () => {
    expect(() => parseSnapshot(null)).toThrow(SaveError);
    expect(() => parseSnapshot({ version: 2, scenario: 'ep1', state: {} })).toThrow('セーブデータの形ではありません');
    expect(() => parseSnapshot(ok, 'clocktower')).toThrow('別の章のセーブデータです（ep1）');
  });
});
