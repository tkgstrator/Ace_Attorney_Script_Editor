// 音と画面の演出（bgm / se / shake / flash / fade / wait）のテスト
import { Engine } from '@gyakusai/core';
import { describe, expect, it } from 'vitest';
import { loadScenario } from '../load.ts';

const YAML = `
id: fx
title: 演出
characters:
  me: { name: 私 }
evidence: {}
start: { scene: s }
scenes:
  s:
    - bgm: trial
      frames: 48
    - se: gavel
    - shake: true
    - flash: red
    - me: 開廷！
    - fade: out
      color: white
      frames: 18
    - me: 真っ白だ。
    - wait: 12
    - fade: in
    - bgm: null
    - end: true
`;

describe('音と画面の演出', () => {
  const sc = () => {
    const { scenario, diagnostics } = loadScenario(YAML);
    if (!scenario) throw new Error(diagnostics.map((d) => d.message).join('\n'));
    return scenario;
  };

  it('bgm・se・shake・flash は止まらずに演出のイベントになり、BGM は状態に残る', () => {
    const e = new Engine(sc());
    expect(e.beat).toMatchObject({ kind: 'line', text: '開廷！' });
    expect(e.drainEvents()).toEqual([
      { type: 'bgm', id: 'trial', frames: 48 },
      { type: 'se', id: 'gavel' },
      { type: 'shake', frames: 30, strength: 0 },
      { type: 'flash', color: 'red', frames: 3 },
    ]);
    expect(e.state.stage.bgm).toBe('trial');
  });

  it('fade と wait は止まり、フェードアウトの後は覆ったまま', () => {
    const e = new Engine(sc());
    e.advance();
    expect(e.beat).toEqual({ kind: 'fade', dir: 'out', color: 'white', frames: 18 });
    expect(e.state.stage.fade).toBe('white');
    e.advance();
    expect(e.beat).toMatchObject({ kind: 'line', text: '真っ白だ。' });
    expect(e.state.stage.fade).toBe('white');
    e.advance();
    expect(e.beat).toEqual({ kind: 'wait', frames: 12 });
    e.advance();
    expect(e.beat).toEqual({ kind: 'fade', dir: 'in', color: 'black', frames: 30 });
    expect(e.state.stage.fade).toBeNull();
    e.advance();
    expect(e.beat.kind).toBe('end');
    expect(e.state.stage.bgm).toBeNull();
  });

  it('BGM はセーブデータから復元され、古いセーブデータでも読める', () => {
    const s = sc();
    const e = new Engine(s);
    const again = new Engine(s, e.snapshot());
    expect(again.state.stage.bgm).toBe('trial');
    const old = e.snapshot();
    // @ts-expect-error 音の追加前のセーブデータ
    delete old.state.stage.bgm;
    // @ts-expect-error 音の追加前のセーブデータ
    delete old.state.stage.fade;
    expect(new Engine(s, old).state.stage).toMatchObject({ bgm: null, fade: null });
  });

  it('台詞の途中の演出を検証する', () => {
    const errs = (text: string) =>
      loadScenario(YAML.replace('開廷！', text))
        .diagnostics.filter((d) => d.severity === 'error')
        .map((d) => d.message);
    expect(errs('な、[wait 8]なんですと[shake 30 1][se damage]！')).toEqual([]);
    expect(errs('"[color red]赤[color white]白"')).toEqual([]); // [ で始まる文は YAML では引用符で囲む
    expect(errs('"[jump 3]"')[0]).toContain('使えません');
    expect(errs('"[wait]"')[0]).toContain('数値が必要');
    expect(errs('"[color pink]"')[0]).toContain('色は');
    expect(errs('閉じない[wait 3')[0]).toContain('閉じられていません');
  });

  it('文中の BGM の切り替えは状態にも残る', () => {
    const { scenario } = loadScenario(YAML.replace('開廷！', '開廷！[bgm objection 0]'));
    expect(new Engine(scenario!).state.stage.bgm).toBe('objection');
  });
});
