// 台詞の途中で詳しく調べて戻ったときに、台詞の続き（調べ始めたページを出し切った形）から見せるテスト
import { Engine, type CompiledScenario } from '@gyakusai/core';
import { describe, expect, it } from 'vitest';
import { LineResume } from './resume.ts';
import { Typewriter } from './typewriter.ts';

const scenario: CompiledScenario = {
  id: 't', title: 't', player: null, maxLife: 5, characters: { a: { name: 'A' } },
  evidence: { box: { name: '箱', description: '', inspect: '@inspect:box' } },
  flags: {}, startScene: 's', startEvidence: ['box'], startProfiles: null, gameoverScene: null, autoPause: false, autoShow: false,
  scenes: {
    s: { kind: 'dialogue', id: 's', program: [{ op: 'say', speaker: 'a', text: 'あいうえおかきくけこ', color: 'white' }, { op: 'end' }] },
    '@inspect:box': {
      kind: 'dialogue', id: '@inspect:box',
      program: [{ op: 'choice', options: [{ text: '底', to: 1 }, { text: 'やめる', to: 3 }] }, { op: 'say', speaker: 'a', text: '底だ', color: 'white' }, { op: 'jump', to: 3 }, { op: 'inspectEnd' }],
    },
  },
  parts: [],
};

const make = (text: string) => new Typewriter(text, {
  wrap: s => s.match(/.{1,4}/gu) ?? [''], linesPerPage: 1, colors: { red: '', blue: '', green: '', orange: '', white: '' },
  autoPause: false, onCommand: () => {},
});

describe('台詞の続きから', () => {
  it('調べ始めたページまで進めて出し切る。別の台詞に戻ったときは何もしない', () => {
    const e = new Engine(scenario);
    const r = new LineResume();
    const before = e.beat;
    e.inspect('box');
    r.remember(e, before, 1);
    // 調べている間の Beat では何もしない
    r.apply(e, e.beat, null);
    e.choose(0);
    e.advance();
    const b = e.beat;
    expect(b.kind).toBe('line');
    const tw = make(b.kind === 'line' ? b.text : '');
    r.apply(e, b, tw);
    expect(tw.page).toBe(1);
    expect(tw.typing).toBe(false);
    // 一度使ったら忘れる
    const again = make('あいうえおか');
    r.apply(e, b, again);
    expect(again.page).toBe(0);
  });
});
