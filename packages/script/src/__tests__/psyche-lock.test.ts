// サイコ・ロックとライフのゲージ（逆転裁判2・3 の遊び）のテスト
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Beat, Engine, LOCK_CURRENT } from '@gyakusai/core';
import { describe, expect, it } from 'vitest';
import { loadScenario } from '../load.ts';
import { verifyScenario } from '../verify.ts';

const yaml = readFileSync(
  fileURLToPath(new URL('../fixtures/psyche-lock.yaml', import.meta.url)),
  'utf8',
);

function load(src = yaml) {
  const { scenario, diagnostics } = loadScenario(src);
  if (!scenario) throw new Error(diagnostics.map((d) => `${d.line} ${d.message}`).join('\n'));
  return scenario;
}

/** 台詞を読み飛ばし、止まった Beat を返す */
function skip(e: Engine): Beat {
  for (let i = 0; i < 1000; i++) {
    const b = e.beat;
    if (b.kind !== 'line' && b.kind !== 'shout') return b;
    e.advance();
  }
  throw new Error('止まりません');
}

describe('サイコ・ロック', () => {
  it('ロックのある話題には印が付き、勾玉をつきつけると挑む', () => {
    const e = new Engine(load());
    const b = skip(e);
    expect(b.kind).toBe('investigate');
    expect(b.kind === 'investigate' && b.talk[0]?.locked).toBe(true);
    e.present('magatama');
    const d = skip(e);
    expect(d.kind === 'demand' && d.giveUp).toBe(true);
    expect(e.state.flags[LOCK_CURRENT]).toBe('lock0');
    expect(e.state.stage.locks).toEqual({ total: 2, left: 2, hidden: false });
    expect(e.state.stage.lifeRisk).toBe(10);
  });

  it('見当違いは予告した量だけライフが減り、やめると元の場所へ戻る（錠は次に挑むと全部戻る）', () => {
    const e = new Engine(load());
    skip(e);
    e.present('magatama');
    skip(e);
    e.present('photo');
    skip(e);
    expect(e.state.life).toBe(70);
    e.present('news');
    expect(e.state.stage.locks?.left).toBe(1);
    skip(e);
    e.giveUp();
    expect(skip(e).kind).toBe('investigate');
    expect(e.state.flags[LOCK_CURRENT]).toBe('');
    e.present('magatama');
    skip(e);
    expect(e.state.stage.locks?.left).toBe(2);
  });

  it('錠を全部壊すと解除され、ライフが回復して話題の印が消える', () => {
    const e = new Engine(load());
    skip(e);
    e.present('magatama');
    skip(e);
    e.present('photo'); // 10 減る
    skip(e);
    e.present('news');
    skip(e);
    e.present('photo');
    const b = skip(e);
    expect(e.state.life).toBe(80);
    expect(e.state.flags.__lock_lock0_active).toBe(false);
    expect(b.kind === 'investigate' && b.talk[0]?.locked).toBeFalsy();
    // 解除した後は、勾玉をつきつけても挑まない
    e.present('magatama');
    expect(e.state.flags[LOCK_CURRENT]).toBe('');
  });

  it('挑戦中にライフが尽きると、ゲームオーバーではなく gaugeOut のシーンへ行き、ライフは 1 になる', () => {
    const e = new Engine(load(yaml.replace('lifeRisk: 10', 'lifeRisk: 80')));
    skip(e);
    e.present('magatama');
    skip(e);
    e.present('photo');
    const b = skip(e);
    expect(e.state.life).toBe(1);
    expect(e.state.flags[LOCK_CURRENT]).toBe('');
    expect(b.kind).toBe('investigate');
  });

  it('整合性チェック: 詰みがなく、ライフが尽きたときのシーンは「たどり着かない」に出さない', () => {
    expect(verifyScenario(load()).findings).toEqual([]);
  });

  it('heal は最大を超えず、true なら最大まで', () => {
    const src = `
id: h
title: h
life: 80
characters: { a: { name: A } }
evidence: {}
start: { scene: s }
scenes:
  s:
    - penalty: 50
    - heal: 40
    - a: 途中
    - heal: true
    - a: 最後
    - end: true
`;
    const e = new Engine(load(src));
    expect(e.state.life).toBe(70);
    e.advance();
    expect(e.state.life).toBe(80);
  });
});
