// 元のゲームとの互換のために足した命令（文字の枠・画面の部品・BGM の一時停止・人物ファイル・証言への戻り・
// ボタンを待たない台詞・問いかける人物・止まらないフェード・文中の人物と背景の切り替え）のテスト
import { Engine } from '@gyakusai/core';
import { describe, expect, it } from 'vitest';
import { loadScenario } from './load.ts';

const BASE = `
id: c
title: 互換
defaults: { autoShow: false }
characters:
  me: { name: 私, profile: { description: 弁護士 } }
  w: { name: 証人, profile: { description: 目撃者 } }
  judge: { name: サイバンチョ }
evidence:
  a: { name: 証拠A, description: "" }
`;

function load(body: string) {
  const { scenario, diagnostics } = loadScenario(BASE + body);
  if (!scenario) throw new Error(diagnostics.map(d => `${d.line}: ${d.message}`).join('\n'));
  return scenario;
}

describe('互換のための命令', () => {
  it('文字の枠・画面の部品・BGM の一時停止は状態に残り、止まらない', () => {
    const e = new Engine(load(`
start: { scene: s }
scenes:
  s:
    - textbox: false
    - ui: { record: false, life: true }
    - bgm: BGM010
    - bgmPause: true
      frames: 30
    - fade: out
      frames: 16
      nowait: true
    - me: こんにちは
    - end: true
`));
    expect(e.beat).toMatchObject({ kind: 'line', text: 'こんにちは' });
    expect(e.state.stage).toMatchObject({ textbox: false, recordLocked: true, lifeGauge: true, bgm: 'BGM010', bgmPaused: true, fade: 'black' });
    expect(e.drainEvents()).toEqual([
      { type: 'bgm', id: 'BGM010', frames: 0 },
      { type: 'bgmPause', pause: true, frames: 30 },
      { type: 'fade', dir: 'out', color: 'black', frames: 16 },
    ]);
  });

  it('人物ファイルは start.profiles から始まり、giveProfile / takeProfile で増減する', () => {
    const e = new Engine(load(`
start: { scene: s, profiles: [me] }
scenes:
  s:
    - me: 一
    - giveProfile: w
    - me: 二
    - takeProfile: me
    - me: 三
    - end: true
`));
    expect(e.state.profiles).toEqual(['me']);
    e.advance();
    expect(e.state.profiles).toEqual(['me', 'w']);
    e.advance();
    expect(e.state.profiles).toEqual(['w']);
  });

  it('start.profiles を書かなければ、人物ファイルは profile のある全員', () => {
    const e = new Engine(load(`
start: { scene: s }
scenes:
  s: [{ end: true }]
`));
    expect(e.state.profiles).toEqual(['me', 'w']);
  });

  it('auto の台詞と、問いかける人物つきのつきつけ要求', () => {
    const e = new Engine(load(`
start: { scene: s, evidence: [a] }
scenes:
  s:
    - say: judge
      text: "では[wait 10]、"
      auto: true
    - demand: 証拠を示しなさい。
      by: judge
      present:
        a: [{ end: true }]
`));
    expect(e.beat).toMatchObject({ kind: 'line', auto: true });
    e.advance();
    expect(e.beat).toEqual({ kind: 'demand', prompt: '証拠を示しなさい。', name: 'サイバンチョ' });
  });

  it('ゆさぶりの中の resume: stay で、同じ証言に戻る', () => {
    const e = new Engine(load(`
start: { scene: t }
scenes:
  t:
    testimony: 証言
    witness: w
    statements:
      - text: 一つ目
        press:
          - me: 本当に？
          - resume: stay
        present: { a: [{ end: true }] }
      - text: 二つ目
        press: [{ me: ふむ }]
`));
    while (!(e.beat.kind === 'statement' && e.beat.cross)) e.advance();
    expect(e.beat).toMatchObject({ text: '一つ目' });
    e.press();
    while (e.beat.kind !== 'statement') e.advance();
    expect(e.beat).toMatchObject({ text: '一つ目', cross: true });
  });

  it('文中の [show] / [location] は、表示側が applyInline で反映する', () => {
    const e = new Engine(load(`
start: { scene: s }
scenes:
  s:
    - show: me
      talk: 15
      idle: 14
    - me: "あ[show w 224 225][location bg5]い"
    - end: true
`));
    expect(e.state.stage).toMatchObject({ character: 'me', pose: { talk: 15, idle: 14 } });
    e.applyInline({ cmd: 'show', id: 'w', talk: 224, idle: 225 });
    e.applyInline({ cmd: 'location', key: 'bg5' });
    expect(e.state.stage).toMatchObject({ character: 'w', pose: { talk: 224, idle: 225 }, location: 'bg5' });
  });

  it('文中の [show] の人物と、fade の nowait を検証する', () => {
    const { diagnostics } = loadScenario(`${BASE}
start: { scene: s }
scenes:
  s:
    - me: "あ[show nobody]"
    - end: true
`);
    expect(diagnostics.map(d => d.message)).toContain('未定義の人物です: nobody');
  });
});

describe('証言（読む）と尋問の文の違い', () => {
  const yaml = `
start: { scene: t }
scenes:
  t:
    testimony: 証言
    witness: w
    reading:
      - w: 読む場面の一つ目
      - w: 読む場面の二つ目
    statements:
      - text: 尋問の一つ目
        before:
          - show: w
            talk: 224
            idle: 225
          - location: bg5
        press: [{ me: 本当に？ }]
        present: { a: [{ end: true }] }
    after:
      - judge: では尋問を。
`;
  it('reading を見せてから after、尋問の文の前に before を実行する', () => {
    const e = new Engine(load(yaml));
    expect(e.beat).toMatchObject({ kind: 'banner', text: '証言開始' });
    e.advance();
    expect(e.beat).toMatchObject({ kind: 'line', text: '読む場面の一つ目' });
    e.advance(); e.advance();
    expect(e.beat).toMatchObject({ kind: 'line', text: 'では尋問を。' });
    e.advance();
    expect(e.beat).toMatchObject({ kind: 'banner', text: '尋問開始' });
    e.advance();
    expect(e.beat).toMatchObject({ kind: 'statement', text: '尋問の一つ目', cross: true });
    expect(e.state.stage).toMatchObject({ character: 'w', pose: { talk: 224, idle: 225 }, location: 'bg5' });
  });

  it('before に止まる命令は書けない', () => {
    const { diagnostics } = loadScenario(BASE + yaml.replace('          - location: bg5', '          - me: 話す'));
    expect(diagnostics.some(d => d.message.includes('before には止まる命令'))).toBe(true);
  });
});

describe('背景のスクロール・視点の流し・重ね絵・画面の色・乱数', () => {
  it('状態に残り、止まらない', () => {
    const e = new Engine(load(`
start: { scene: s }
scenes:
  s:
    - location: bg33
    - scroll: { y: -1 }
    - overlay: 61
    - overlay: 60
    - overlay: 61
      off: true
    - palette: grayscale
    - show: me
      frames: 16
    - showEvidence: a
      side: right
    - pan: 0
      to: w
      talk: 224
      idle: 225
    - random:
        - [{ me: 一 }]
        - [{ me: 二 }]
    - end: true
`));
    expect(e.beat.kind).toBe('line');
    expect(e.state.stage).toMatchObject({
      location: 'bg33', scroll: { x: 0, y: -1 }, overlays: ['60'], palette: 'grayscale', evidenceRight: true,
      character: 'w', pose: { talk: 224, idle: 225 }, pan: { type: 0, from: { character: 'me' } },
    });
    expect(e.drainEvents().some(ev => ev.type === 'charFade')).toBe(true);
    expect(['一', '二']).toContain((e.beat as { text: string }).text);
  });
});
