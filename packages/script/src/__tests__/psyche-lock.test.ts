// サイコ・ロックとライフのゲージ（逆転裁判2・3 の遊び）のテスト
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Beat, Engine, LOCK_CURRENT, lockEndScene } from '@gyakusai/core';
import { describe, expect, it } from 'vitest';
import { loadScenario } from '../load.ts';
import { lockEndMessage, verifyScenario } from '../verify.ts';

const yaml = readFileSync(
  fileURLToPath(new URL('../fixtures/psyche-lock.yaml', import.meta.url)),
  'utf8',
);

const lock23 = readFileSync(
  fileURLToPath(new URL('../fixtures/lock23.yaml', import.meta.url)),
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

  it('ロックを外さないままクリアできる台本は、整合性チェックが報告する（ロックが先へ進むのを止めていない）', () => {
    // 話題の中身が解除を待たない（元のゲームでは、解除の台本が話題を切り替えるまで先の話は出ない）
    const open = yaml.replace('- if: unlocked\n', '- if: unlocked or not unlocked\n');
    const sc = load(open);
    expect(Object.keys(sc.scenes)).toContain(lockEndScene('lock0'));
    expect(verifyScenario(sc).findings).toEqual([
      { severity: 'error', message: lockEndMessage('lock0') },
    ]);
    // 遊ぶときは、印のシーンを通って end になる
    const e = new Engine(sc);
    const b = skip(e);
    e.talk(b.kind === 'investigate' ? b.talk[0]!.id : '');
    expect(skip(e).kind).toBe('end');
    expect(e.state.scene).toBe(lockEndScene('lock0'));
  });

  it('錠が 5 つより多いときは、5 回壊すと解除される（元のゲームは残りを 5 にしてから減らす）', () => {
    const six = yaml
      .replace('locks: 2', 'locks: 6')
      .replace('- goto: lock_q2\n', '- goto: lock_q1\n')
      .replace('lifeRisk: 10', 'lifeRisk: 0');
    const e = new Engine(load(six));
    skip(e);
    e.present('magatama');
    for (let i = 0; i < 4; i++) {
      skip(e);
      e.present('news');
    }
    expect(e.state.flags.__lock_lock0_active).toBe(true);
    skip(e);
    e.present('news');
    expect(e.state.flags.__lock_lock0_active).toBe(false);
  });

  it('quitLock（選択肢の「やめる」など）で挑戦をやめ、quit のシーンへ行く', () => {
    const e = new Engine(load(lock23));
    skip(e);
    e.present('magatama');
    const c = skip(e);
    expect(c.kind).toBe('choice');
    expect(e.state.flags[LOCK_CURRENT]).toBe('lock0');
    e.choose(2);
    expect(skip(e).kind).toBe('investigate');
    expect(e.state.flags[LOCK_CURRENT]).toBe('');
    expect(e.state.flags.__lock_lock0_active).toBe(true);
  });

  it('尋問でも、present に人物 ID を書いた証言では人物ファイルをつきつけられる（逆転裁判2・3）', () => {
    const e = new Engine(load(lock23));
    skip(e);
    e.present('magatama');
    skip(e);
    e.choose(0);
    const inv = skip(e);
    e.talk(inv.kind === 'investigate' ? inv.talk[0]!.id : '');
    // 証言を聞き終えて尋問へ
    let b = skip(e);
    for (let i = 0; i < 20 && !(b.kind === 'statement' && b.cross); i++) {
      e.advance();
      b = skip(e);
    }
    expect(e.canPresentProfile).toBe(true);
    e.present('larry');
    expect(skip(e).kind).toBe('end');
    expect(verifyScenario(load(lock23)).findings).toEqual([]);
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
