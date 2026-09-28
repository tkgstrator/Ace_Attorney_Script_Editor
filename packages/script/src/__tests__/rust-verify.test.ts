// 整合性チェックの Rust 版（crates/aa-verify）が、TS 版（verify.ts）と同じ報告を出すかのテスト。
// Rust 版のバイナリ（target/release/aa-verify）がなければ飛ばす（cargo build --release -p aa-verify で作る）。
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadScenario } from '../load.ts';
import { type Finding, verifyScenario } from '../verify.ts';

const bin = fileURLToPath(new URL('../../../../target/release/aa-verify', import.meta.url));
const sample = readFileSync(
  fileURLToPath(new URL('../../../../apps/player/cases/clocktower.yaml', import.meta.url)),
  'utf8',
);

interface RustResult {
  states: number;
  truncated: boolean;
  findings: Finding[];
}

function compile(yaml: string) {
  const { scenario, diagnostics } = loadScenario(yaml);
  if (!scenario) throw new Error(diagnostics.map((d) => d.message).join('\n'));
  return scenario;
}

let n = 0;
function rust(
  yaml: string,
  flags: string[],
): RustResult & { findings: (Finding & { kind?: string })[] } {
  const file = join(tmpdir(), `aa-verify-test-${process.pid}-${n++}.json`);
  writeFileSync(file, JSON.stringify(compile(yaml)));
  // 問題があると終了コードが 1 になるので、出力だけを読む
  let out: string;
  try {
    out = execFileSync(bin, ['--json', ...flags, file], { encoding: 'utf8' });
  } catch (e) {
    out = (e as { stdout: string }).stdout;
  }
  return JSON.parse(out) as RustResult;
}

const key = (f: Finding) => `${f.severity}|${f.scene ?? ''}|${f.message}`;

/** TS 版と、Rust 版の 2 つのモードの報告が一致することを確かめる */
function same(yaml: string) {
  const ts = verifyScenario(compile(yaml));
  const exact = rust(yaml, ['--complete', '--ts-exact']);
  const fast = rust(yaml, ['--complete']);
  // TS と同じ見分け方: 報告の並びと状態の数まで同じ
  expect(exact.findings.map(key)).toEqual(ts.findings.map(key));
  expect(exact.states).toBe(ts.states);
  // 既定（編ごと・証拠品の生きている変数）: 報告の集まりが同じ
  expect(fast.findings.map(key).sort()).toEqual(ts.findings.map(key).sort());
  return ts;
}

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

describe.skipIf(!existsSync(bin))('整合性チェックの Rust 版', () => {
  it('サンプル事件と、壊したサンプル事件で、TS 版と同じ報告を出す', () => {
    expect(same(sample).findings).toEqual([]);
    const noClock = sample.replace('                  - give: clock\n', '');
    const broken = [
      noClock,
      noClock.replace('when: has(repair) and has(clock)', 'when: has(repair)'),
      sample.replace('when: seen(night)', 'when: seen(night) and has(keys)'),
    ];
    for (const y of broken) expect(same(y).findings.length).toBeGreaterThan(0);
  });

  it('乱数・数の計算・調べる範囲の重なり・話題の順番でも、TS 版と同じ報告を出す', () => {
    same(
      tiny(
        '  x: 0',
        `
  s:
    - random:
        - - a: 当たり
          - end: true
        - - goto: dead
  dead:
    - a: 抜け出せない
    - goto: dead`,
      ),
    );
    same(
      tiny(
        '  count: 0',
        `
  s:
    - choice:
        - text: 足す
          then:
            - add: { count: 1 }
    - if: count + 0 == 2
      then:
        - end: true
    - goto: s`,
      ),
    );
    const topics = [1, 2, 3, 4, 5];
    same(
      tiny(
        topics.map((i) => `  t${i}: false`).join('\n'),
        `
  s:
    - choice:
${topics.map((i) => `        - text: 話題${i}\n          when: not t${i}\n          then:\n            - a: 話題${i}の話\n            - set: { t${i}: true }`).join('\n')}
        - text: 法廷へ
          when: t1
          then:
            - goto: trial
    - goto: s
  trial:
    - choice:
        - text: 終わる
          then:
            - end: true
        - text: 戻る
          then:
            - goto: trial`,
      ),
    );
    same(
      tiny(
        '  n: 0\n  flag: false',
        `
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
    - goto: s`,
      ),
    );
  });

  it('証拠品を詳しく調べて手に入る証拠品も、TS 版と同じく扱う', () => {
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
    expect(same(yaml).findings).toEqual([]);
  });

  it('人物ファイルのつきつけと、台詞・証言・選択肢の途中で詳しく調べるのも、TS 版と同じく扱う', () => {
    const fixture = (name: string) =>
      readFileSync(fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url)), 'utf8');
    expect(same(fixture('profile-inspect.yaml')).findings).toEqual([]);
    expect(same(fixture('testimony-inspect.yaml')).findings).toEqual([]);
    // 見当違いの反応に人物ファイルでしか着けない場所・法廷記録を使えなくしている間
    const onlyProfile = fixture('profile-inspect.yaml').replace(
      'start: { scene: intro, evidence: [badge], profiles: [tomoe] }',
      'start: { scene: intro, evidence: [], profiles: [] }',
    );
    same(onlyProfile);
  });

  it('サイコ・ロック（勾玉で挑む・やめる・錠を壊す）も、TS 版と同じく扱う', () => {
    const yaml = readFileSync(
      fileURLToPath(new URL('../fixtures/psyche-lock.yaml', import.meta.url)),
      'utf8',
    );
    expect(same(yaml).findings).toEqual([]);
    // 2 つ目の錠の正解を持っていないと、挑戦は抜け出せる（やめる）が、話題が開かずに詰む
    const noPhoto = yaml.replace('evidence: [magatama, news, photo]', 'evidence: [magatama, news]');
    expect(same(noPhoto).findings.some((f) => f.severity === 'error')).toBe(true);
    // 尋問で人物ファイルをつきつける・選択肢で挑戦をやめる（quitLock）
    const lock23 = readFileSync(
      fileURLToPath(new URL('../fixtures/lock23.yaml', import.meta.url)),
      'utf8',
    );
    expect(same(lock23).findings).toEqual([]);
    // 人物ファイルを持っていないと尋問から先へ進めない
    const noProfile = lock23.replace('profiles: [larry]', 'profiles: []');
    expect(same(noProfile).findings.some((f) => f.severity === 'error')).toBe(true);
  });

  it('横長の背景の場所（範囲は背景の座標）で、画面の幅より右の範囲も TS 版と同じく試す', () => {
    const wide = readFileSync(
      fileURLToPath(new URL('../fixtures/wide-examine.yaml', import.meta.url)),
      'utf8',
    );
    expect(same(wide).findings).toEqual([]);
  });

  it('台詞の途中で詳しく調べたときにだけ起きる詰みも、TS 版と同じく見つける', () => {
    const ts = same(`
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
        when: mark == 0
        then:
          - set: { mark: 1 }
flags:
  mark: 0
  bad: false
start: { scene: s, evidence: [box] }
scenes:
  s:
    - a: 一つめ
    - if: mark == 1
      then:
        - set: { bad: true }
    - a: 二つめ
    - choice:
        - text: 終わる
          when: not bad
          then:
            - end: true
        - text: 待つ
    - a: 待った。
    - goto: s`);
    expect(ts.findings.some((f) => f.message.startsWith('詰み'))).toBe(true);
  });

  it('軽いチェックは、手に入らない証拠品・着けない場所・満たせない条件を、項目ごとに報告する', () => {
    const light = (y: string) => rust(y, []).findings as (Finding & { kind?: string })[];
    expect(light(sample)).toEqual([]);
    // 置時計が手に入らず、法廷へ行く条件も満たせない: 法廷に着けない
    const noClock = sample.replace('                  - give: clock\n', '');
    expect(light(noClock).some((f) => f.kind === '到達' && f.message.includes('court_gate'))).toBe(
      true,
    );
    // 法廷へは行けるが、つきつけの要求の正解（置時計）を持てない
    const demand = light(noClock.replace('when: has(repair) and has(clock)', 'when: has(repair)'));
    expect(
      demand.some(
        (f) => f.kind === '証拠品' && f.severity === 'error' && f.message.includes('置時計'),
      ),
    ).toBe(true);
    const topic = light(sample.replace('when: seen(night)', 'when: seen(night) and has(keys)'));
    expect(topic.some((f) => f.kind === 'フラグ' && f.message.includes('話題「時計塔の鐘」'))).toBe(
      true,
    );
  });
});
