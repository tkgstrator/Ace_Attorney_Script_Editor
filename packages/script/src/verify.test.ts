// 整合性チェック（すべての遊び方を試して、詰み・到達しないものを見つける）のテスト
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadScenario } from './load.ts';
import { verifyScenario, type VerifyOptions } from './verify.ts';

const sample = readFileSync(fileURLToPath(new URL('../../../apps/player/cases/clocktower.yaml', import.meta.url)), 'utf8');

function verify(yaml: string, opts?: VerifyOptions) {
  const { scenario, diagnostics } = loadScenario(yaml);
  if (!scenario) throw new Error(diagnostics.map(d => d.message).join('\n'));
  return verifyScenario(scenario, opts);
}

/** 小さなシナリオ（scenes と flags だけを差し替える） */
const tiny = (flags: string, scenes: string) => `
id: t
title: t
player: a
characters:
  a: { name: A }
evidence:
  memo: { name: メモ, description: メモ }
flags:
${flags}
start:
  scene: s
scenes:
${scenes}`;

describe('整合性チェック', () => {
  it('サンプル事件には問題がない', () => {
    const r = verify(sample);
    expect(r.truncated).toBe(false);
    expect(r.findings).toEqual([]);
    expect(verify(sample, { liveness: false }).findings).toEqual([]);
  });

  it('探索編で手に入らない証拠品を、法廷のつきつけで求めていると詰みになる', () => {
    const broken = sample
      .replace('                  - give: clock\n', '')
      .replace('when: has(repair) and has(clock)', 'when: has(repair)');
    const r = verify(broken);
    const msgs = r.findings.map(f => f.message);
    expect(msgs).toContain('どう遊んでもクリア（end）にたどり着けません');
    expect(msgs.some(m => m.startsWith('詰み: つきつけの要求') && m.includes('置時計'))).toBe(true);
  });

  it('探索編から出る条件を満たせないと、探索編で詰みになる', () => {
    const broken = sample.replace('                  - give: clock\n', '');
    const r = verify(broken);
    const f = r.findings.find(x => x.message.startsWith('詰み'));
    expect(f?.message).toContain('探索編');
    expect(r.findings.some(x => x.message.includes('シーン「opening」には、どう遊んでもたどり着きません'))).toBe(true);
  });

  it('条件を満たせない話題を報告する', () => {
    const r = verify(sample.replace('when: seen(night)', 'when: seen(night) and has(keys)'));
    expect(r.findings.map(f => f.message)).toContain('場所「時計塔の広場」の話題「時計塔の鐘」は、どう遊んでも選べません');
  });

  it('もう読まれないフラグは状態の区別に入れないが、結果は変わらない', () => {
    // 探偵パートで 5 つの話題を好きな順に聞き（聞いたかをフラグで覚える）、その後の法廷では読まない
    const topics = [1, 2, 3, 4, 5];
    const yaml = tiny(topics.map(i => `  t${i}: false`).join('\n'), `
  s:
    - choice:
${topics.map(i => `        - text: 話題${i}\n          when: not t${i}\n          then:\n            - a: 話題${i}の話\n            - set: { t${i}: true }`).join('\n')}
        - text: 法廷へ
          when: t1
          then:
            - goto: pass
    - goto: s
  pass:
    - set: { t2: false }
    - goto: trial
  trial:
${Array.from({ length: 20 }, (_, i) => `    - a: 法廷の台詞${i}`).join('\n')}
    - choice:
        - text: 終わる
          then:
            - end: true
        - text: 戻る
          then:
            - goto: trial`);
    const fast = verify(yaml), slow = verify(yaml, { liveness: false });
    expect(fast.findings).toEqual([]);
    expect(slow.findings).toEqual([]);
    expect(fast.states).toBeLessThan(slow.states);
  });

  it('乱数で飛ぶ所は、すべての行き先を試す', () => {
    const yaml = tiny('  x: 0', `
  s:
    - random:
        - - a: 当たり
          - end: true
        - - goto: dead
  dead:
    - a: 抜け出せない
    - goto: dead`);
    for (let n = 0; n < 5; n++) {
      const r = verify(yaml);
      expect(r.findings.some(f => f.message.startsWith('詰み') && f.scene === 'dead')).toBe(true);
    }
  });

  it('数値のフラグを計算に使う条件でも、値をまとめずに調べる', () => {
    const yaml = tiny('  count: 0', `
  s:
    - choice:
        - text: 足す
          then:
            - add: { count: 1 }
    - if: count + 0 == 2
      then:
        - end: true
    - goto: s`);
    expect(verify(yaml).findings).toEqual([]);
  });

  it('上限を超えたら打ち切り、そう報告する', () => {
    const r = verify(sample, { limit: 3 });
    expect(r.truncated).toBe(true);
    expect(r.findings.map(f => f.message)).toContain('状態が 3 個を超えたため、途中で調べるのをやめました（結果は不完全です）');
  });

  it('重なった調べる範囲の、手前の範囲に隠れた中心を持つ範囲も調べられる', () => {
    // 奥の範囲 back の中心 (90, 90) は手前の範囲 front に入るが、front の外にはみ出た所は調べられる
    const yaml = `
id: t
title: t
player: a
characters:
  a: { name: A }
evidence: {}
start:
  scene: s
parts:
  - id: p
    kind: investigation
    title: 探偵
    scenes:
      s:
        - investigate: room
    places:
      room:
        name: 部屋
        person: a
        examine:
          - id: front
            area: [0, 0, 100, 100]
            then:
              - a: 手前
          - id: back
            name: 奥
            area: [40, 40, 100, 100]
            then:
              - a: 奥
              - end: true`;
    expect(verify(yaml).findings).toEqual([]);
  });

  it('証拠品を詳しく調べて手に入る証拠品も、つきつけに使える', () => {
    const yaml = `
id: t
title: t
player: a
characters:
  a: { name: A }
evidence:
  box:
    name: 箱
    description: 箱
    examine:
      - spot: 底
        then:
          - give: key
  key: { name: 鍵, description: 鍵 }
start:
  scene: s
  evidence: [box]
parts:
  - id: p
    kind: trial
    title: 法廷
    scenes:
      s:
        - demand: 鍵を見せなさい
          present:
            key:
              - end: true
          wrong:
            - a: 違う`;
    expect(verify(yaml).findings).toEqual([]);
  });

  it('操作の結果のメモを使っても使わなくても、結果は同じ', () => {
    const yaml = tiny('  n: 0\n  flag: false', `
  s:
    - choice:
        - text: 拾う
          then:
            - give: memo
            - set: { flag: true }
        - text: 捨てる
          when: has(memo)
          then:
            - take: memo
        - text: 数える
          then:
            - add: { n: 1 }
        - text: 寄り道
          then:
            - goto: side
        - text: 終わる
          when: visited(side) and not has(memo) and flag and n >= 2
          then:
            - end: true
    - goto: s
  side:
    - a: 寄り道
    - goto: s`);
    const on = verify(yaml), off = verify(yaml, { memo: false });
    expect(on.findings).toEqual([]);
    expect(off.findings).toEqual([]);
    expect(on.states).toBe(off.states);
    for (const y of [sample, sample.replace('when: seen(night)', 'when: seen(night) and has(keys)')]) {
      const a = verify(y), b = verify(y, { memo: false });
      expect(a.findings).toEqual(b.findings);
      expect(a.states).toBe(b.states);
    }
  });
});
