// エディタの「ここから再生」: ステップの位置（YAML のパス）から遊び始める位置を決め、そこから遊ぶテスト
import { readFileSync } from 'node:fs';
import { type Beat, Engine, type PlayTarget, restoreEngine } from '@gyakusai/core';
import { describe, expect, it } from 'vitest';
import type { Path } from '../compile.ts';
import { loadScenario } from '../load.ts';
import { targetForPath } from '../source-map.ts';

const SAMPLE = readFileSync(
  new URL('../../../../apps/player/cases/clocktower.yaml', import.meta.url),
  'utf8',
);

function load(yaml: string) {
  const r = loadScenario(yaml);
  if (!r.scenario || !r.sources) throw new Error(r.diagnostics.map((d) => d.message).join('\n'));
  return { scenario: r.scenario, sources: r.sources };
}

const sample = load(SAMPLE);
const TRIAL: Path = ['parts', 1, 'scenes'];

const target = (c: ReturnType<typeof load>, path: Path) =>
  targetForPath(c.scenario.scenes, c.sources, path);

/** path から遊び始めて、最初の Beat */
function playFrom(c: ReturnType<typeof load>, path: Path, prev?: Engine, fresh = false) {
  const t = target(c, path);
  if (!t) throw new Error(`位置が見つかりません: ${path.join('.')}`);
  const e = prev ?? new Engine(c.scenario);
  const r = restoreEngine(
    c.scenario,
    { scenario: e.scenario, state: e.state },
    { at: t.target, fresh },
  );
  return { ...r, target: t };
}

const text = (b: Beat) => ('text' in b ? b.text : b.kind);

describe('targetForPath', () => {
  it('会話の途中のステップは、その命令の位置', () => {
    const t = target(sample, [...TRIAL, 'opening', 2]);
    expect(t?.exact).toBe(true);
    expect(t?.target).toMatchObject({ kind: 'pc', scene: 'opening' });
  });

  it('シーン・証言そのもの', () => {
    expect(target(sample, [...TRIAL, 't1'])?.target).toEqual({ kind: 'scene', scene: 't1' });
    expect(target(sample, [...TRIAL, 't1', 'statements', 1])?.target).toEqual({
      kind: 'statement',
      scene: 't1',
      statement: 1,
    });
  });

  it('ゆさぶりの中のステップは、その証言の中の位置', () => {
    const t = target(sample, [...TRIAL, 't1', 'statements', 1, 'press', 2, 'then', 1]);
    expect(t?.target).toMatchObject({ kind: 'pc', scene: 't1', statement: 1 });
  });

  it('命令の無い所は、それを含むいちばん近い所', () => {
    // 無いステップ → その列の最初のステップ
    const t = target(sample, [...TRIAL, 'bell_choice', 0, 'choice', 1, 'then', 99]);
    expect(t?.exact).toBe(false);
    const pc = t?.target.kind === 'pc' ? t.target.pc : -1;
    expect(sample.scenario.scenes.bell_choice!.program[pc]).toMatchObject({ op: 'say' });
    // 中身の無い選択肢の中 → 選択肢のステップ
    const c = load(`
id: c
title: c
characters: { me: { name: 私 } }
evidence: {}
start: { scene: one }
scenes:
  one:
    - me: 前
    - choice:
        - text: 空
          then: []
        - text: 続き
    - end: true
`);
    const u = target(c, ['scenes', 'one', 1, 'choice', 0, 'then', 0]);
    const at = u?.target.kind === 'pc' ? u.target.pc : -1;
    expect(c.scenario.scenes.one!.program[at]?.op).toBe('choice');
  });
});

describe('ここから再生', () => {
  it('会話の途中の台詞から', () => {
    const r = playFrom(sample, ['parts', 0, 'scenes', 'prologue', 3]);
    expect(r.result).toBe('at');
    expect(text(r.engine.beat)).toBe('（事件の現場の近くを、自分の目で調べておこう）');
    // 前にある日時の表示・BGM は、画面の用意として当てておく
    expect(r.engine.state.stage.bgm).toBe('investigation');
  });

  it('選択肢の中の台詞から。続けると選択肢の後へ進む', () => {
    const r = playFrom(sample, [...TRIAL, 'bell_choice', 0, 'choice', 1, 'then', 1]);
    expect(text(r.engine.beat)).toBe('ほう。では、何の鐘だというのだ。');
    r.engine.advance();
    expect(r.engine.beat.kind).toBe('demand');
  });

  it('証言の文から尋問を始める', () => {
    const r = playFrom(sample, [...TRIAL, 't1', 'statements', 1]);
    const b = r.engine.beat;
    expect(b.kind === 'statement' && b.cross).toBe(true);
    expect(text(b)).toBe('ちょうど夜の9時、時計塔の鐘が鳴ったんです。');
  });

  it('ゆさぶりの中から始めると、終えたら次の証言へ', () => {
    const r = playFrom(sample, [...TRIAL, 't1', 'statements', 0, 'press', 1]);
    expect(text(r.engine.beat)).toBe('散歩ですよ。医者に歩けと言われていましてね。');
    r.engine.advance();
    const b = r.engine.beat;
    expect(b.kind === 'statement' && b.text).toBe('ちょうど夜の9時、時計塔の鐘が鳴ったんです。');
  });

  it('状態を保つか、最初の状態にするか', () => {
    const e = new Engine(sample.scenario);
    e.setFlag('asked_bell', true);
    const path = [...TRIAL, 't1', 'statements', 2];
    expect(playFrom(sample, path, e).engine.state.flags.asked_bell).toBe(true);
    expect(playFrom(sample, path, e, true).engine.state.flags.asked_bell).toBe(false);
  });

  it('探偵パートの場所と、調べるブロックの中から', () => {
    const place = playFrom(sample, ['parts', 0, 'places', 'plaza']);
    expect(place.engine.state.scene).toBe('plaza');
    const r = playFrom(sample, ['parts', 0, 'places', 'plaza', 'examine', 1, 'then', 0]);
    expect(text(r.engine.beat)).toBe('（証人が座っていたというベンチだ。時計塔がよく見える）');
    expect(r.engine.state.stage.location).toBe('plaza');
    r.engine.advance();
    expect(r.engine.beat.kind).toBe('investigate');
  });

  it('始められない位置なら、シーンの始めから', () => {
    const bad: PlayTarget = { kind: 'pc', scene: 'opening', pc: 99_999 };
    const e = new Engine(sample.scenario);
    const r = restoreEngine(sample.scenario, { scenario: e.scenario, state: e.state }, { at: bad });
    expect(r.result).toBe('sceneStart');
    expect(r.scene).toBe('opening');
  });
});
