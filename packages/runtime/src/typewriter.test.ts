// 文字送り（台詞の途中の演出を、その文字の位置で実行する）のテスト
import type { InlineCommand } from '@gyakusai/core';
import { describe, expect, it } from 'vitest';
import { Typewriter } from './typewriter.ts';

const FRAME = 1000 / 60;

/** 1 行 4 文字で折り返す */
const wrap4 = (s: string) => s.split('\n').flatMap(p => p.match(/.{1,4}/gu) ?? ['']);

function make(text: string, opts: { autoPause?: boolean; linesPerPage?: number } = {}) {
  const fired: InlineCommand[] = [];
  const tw = new Typewriter(text, {
    wrap: wrap4, linesPerPage: opts.linesPerPage ?? 2, colors: { red: '#f00', blue: '#00f', green: '#0f0', orange: '#fa0', white: '#fff' },
    autoPause: opts.autoPause ?? false, onCommand: c => fired.push(c),
  });
  return { tw, fired };
}
const text = (tw: Typewriter) => tw.visible.map(r => r.map(g => g.ch).join(''));

describe('文字送り', () => {
  it('既定では 1 文字 3 フレームで出す', () => {
    const { tw } = make('あいう');
    tw.tick(3 * FRAME);
    expect(text(tw)).toEqual(['あ']);
    tw.tick(6 * FRAME);
    expect(text(tw)).toEqual(['あいう']);
    expect(tw.typing).toBe(false);
  });

  it('[wait] で待ち、[speed] で速さが変わる', () => {
    const { tw } = make('あ[wait 10]い[speed 1]うえ');
    tw.tick(3 * FRAME);
    expect(text(tw)).toEqual(['あ']);
    tw.tick(10 * FRAME); // 待っている間は進まない
    expect(text(tw)).toEqual(['あ']);
    tw.tick(3 * FRAME);
    expect(text(tw)).toEqual(['あい']);
    tw.tick(2 * FRAME); // 以降は 1 フレームに 1 文字
    expect(text(tw)).toEqual(['あいうえ']);
  });

  it('揺れ・音は直前の文字を出し終えたところで実行し、最後の文字の後のものも実行する', () => {
    const { tw, fired } = make('な、[shake 30 1]なんですと[se damage]');
    tw.tick(5 * FRAME);
    expect(fired).toEqual([]);
    tw.tick(1 * FRAME);
    expect(fired).toEqual([{ cmd: 'shake', frames: 30, strength: 1 }]);
    expect(tw.typing).toBe(true);
    tw.tick(100 * FRAME);
    expect(fired.at(-1)).toEqual({ cmd: 'se', id: 'damage' });
    expect(tw.typing).toBe(false);
  });

  it('[color] は文字ごとの色になり、ページをまたいでも続く', () => {
    const { tw } = make('あ[color red]いうえおかきくけ[color white]こ', { linesPerPage: 1 });
    tw.finish();
    expect(tw.full[0]!.map(g => g.color)).toEqual([null, '#f00', '#f00', '#f00']);
    tw.nextPage(); tw.finish();
    expect(tw.full[0]!.map(g => g.color)).toEqual(['#f00', '#f00', '#f00', '#f00']);
    tw.nextPage(); tw.finish();
    expect(tw.full[0]!.map(g => [g.ch, g.color])).toEqual([['け', '#f00'], ['こ', null]]);
  });

  it('飛ばすとページの最後まで出し、BGM の切り替えだけは実行する', () => {
    const { tw, fired } = make('あ[se a]い[bgm trial 30]う');
    tw.finish();
    expect(text(tw)).toEqual(['あいう']);
    expect(fired).toEqual([{ cmd: 'bgm', id: 'trial', frames: 30 }]);
  });

  it('改行とページ分けで、コマンドの位置がずれない', () => {
    const { tw, fired } = make('あいうえお\nか[se x]き', { linesPerPage: 2 });
    expect(tw.pages.map(p => p.lines.map(r => r.map(g => g.ch).join('')))).toEqual([['あいうえ', 'お'], ['かき']]);
    tw.finish(); tw.nextPage();
    tw.tick(2 * FRAME);
    expect(fired).toEqual([]);
    tw.tick(1 * FRAME); // 「か」を出し終えたところ
    expect(text(tw)).toEqual(['か']);
    expect(fired).toEqual([{ cmd: 'se', id: 'x' }]);
  });

  it('autoPause のときだけ、句読点のあとで待つ', () => {
    const plain = make('あ。い');
    plain.tw.tick(6 * FRAME);
    expect(text(plain.tw)).toEqual(['あ。']);
    const paused = make('あ。い', { autoPause: true });
    paused.tw.tick(9 * FRAME);
    expect(text(paused.tw)).toEqual(['あ。']);
    paused.tw.tick(9 * FRAME);
    expect(text(paused.tw)).toEqual(['あ。い']);
  });
});
