import { describe, expect, test } from 'bun:test';
import {
  bgKey,
  charArg,
  colorName,
  dsFx,
  escapeText,
  fadeOf,
  flagArg,
  ifFlagArg,
  inline,
  nameArg,
  recordArg,
  shoutKind,
  speedValue,
  stripTilde,
} from '../mapping.ts';
import { parseProfileName, slug } from '../tables.ts';

describe('引数の写し方', () => {
  test('色・速さ・文のエスケープ', () => {
    expect([0, 1, 2, 3].map(colorName)).toEqual(['white', 'red', 'blue', 'green']);
    expect(speedValue(255)).toBe(3);
    expect(speedValue(5)).toBe(5);
    expect(escapeText('a[b')).toBe('a[[b');
  });

  test('背景: 立ち位置は stand の鍵、4095 は black、0x8000 は alt', () => {
    expect(bgKey(3)).toEqual({ key: 'defense', alt: false });
    expect(bgKey(5)).toEqual({ key: 'witness', alt: false });
    expect(bgKey(42)).toEqual({ key: 'bg42', alt: false });
    expect(bgKey(4095)).toEqual({ key: 'black', alt: false });
    expect(bgKey(0x8000 | 30)).toEqual({ key: 'bg30', alt: true });
  });

  test('人物・法廷記録・名前・フラグの引数', () => {
    expect(charArg(0x8000 | 26)).toEqual({ id: 26, left: true, right: false, flip: false });
    expect(recordArg(32773)).toEqual({ kind: 'profile', id: 5, notice: false });
    expect(recordArg(16393)).toEqual({ kind: 'evidence', id: 9, notice: true });
    expect(nameArg(26 << 8)).toBe(26);
    expect(flagArg((1 << 15) | (2 << 8) | 7)).toEqual({ value: true, group: 2, index: 7 });
    expect(ifFlagArg((5 << 8) | 0x80 | 1)).toEqual({ index: 5, label: true, want: true });
    expect(dsFx(273)).toEqual({ stage: 1, effect: 17 });
  });

  test('フェード: 白いフラッシュ・黒へ・黒から', () => {
    expect(fadeOf([769, 8, 31], null)).toEqual({ kind: 'flash', frames: 3 });
    expect(fadeOf([513, 1, 31], null)).toEqual({
      kind: 'fade',
      dir: 'out',
      color: 'black',
      frames: 16,
    });
    expect(fadeOf([514, 1, 31], null)).toEqual({
      kind: 'fade',
      dir: 'out',
      color: 'black',
      frames: 32,
    });
    expect(fadeOf([516, 1, 31], null)).toEqual({
      kind: 'fade',
      dir: 'out',
      color: 'black',
      frames: 64,
    });
    expect(fadeOf([257, 8, 31], 'black')).toEqual({
      kind: 'fade',
      dir: 'in',
      color: 'black',
      frames: 2,
    });
    expect(fadeOf([1025, 1, 31], null)).toEqual({
      kind: 'fade',
      dir: 'out',
      color: 'white',
      frames: 16,
    });
    expect(fadeOf([769, 1, 31], 'white')).toEqual({
      kind: 'fade',
      dir: 'in',
      color: 'white',
      frames: 16,
    });
    expect(fadeOf([1281, 4, 31], null)).toEqual({ kind: 'native' });
  });

  test('吹き出し', () => {
    expect([1, 10, 2, 3, 11, 4, 20].map(shoutKind)).toEqual([
      'hold',
      'hold',
      'objection',
      'objection',
      'objection',
      'takethat',
      null,
    ]);
  });

  test('文中コマンドの形', () => {
    expect(inline.flash(3)).toBe('[flash]');
    expect(inline.flash(5)).toBe('[flash white 5]');
    expect(inline.bgm(null, 60)).toBe('[bgm null 60]');
    expect(inline.shake(30, 3)).toBe('[shake 30 2]');
  });

  test('名前・タイトル', () => {
    expect(stripTilde('～事件の当日、目撃したこと～')).toBe('事件の当日、目撃したこと');
    expect(slug('Alarm clock')).toBe('alarm_clock');
    expect(slug('???')).toBe('');
    expect(parseProfileName('綾里 千尋（27）')).toEqual({ name: '綾里 千尋', age: 27 });
    expect(parseProfileName('置物')).toEqual({ name: '置物' });
  });
});
