// 画面の枠に収まらない文の警告（--check-fit）のテスト
import { describe, expect, it } from 'vitest';
import { loadScenario } from '../load.ts';
import { FIT, wrapLines } from '../verify-text-fit.ts';

const HEAD = `id: t
title: t
characters:
  me: { name: 私 }
evidence:
  a: { name: A, description: "" }
start: { scene: s }
scenes:
  s:
`;

const fit = (source: string) =>
  loadScenario(source, { checkFit: true }).diagnostics.filter((d) => d.severity === 'warning');
const withSteps = (steps: string) => `${HEAD}${steps}    - end: true\n`;

describe('折り返し', () => {
  it('16 字で折り返し、行頭に来ない字は前の行にぶら下げる', () => {
    expect(wrapLines('あ'.repeat(17), 16)).toEqual(['あ'.repeat(16), 'あ']);
    expect(wrapLines(`${'あ'.repeat(16)}。`, 16)).toEqual([`${'あ'.repeat(16)}。`]);
  });

  it('改行はそのまま行を分ける', () => {
    expect(wrapLines('あ\nい\nう', 16)).toEqual(['あ', 'い', 'う']);
  });
});

describe('枠に収まらない文', () => {
  it('checkFit を渡さなければ何も調べない（既定）', () => {
    const src = withSteps(`    - me: "${'あ'.repeat(40)}"\n`);
    expect(loadScenario(src).diagnostics).toEqual([]);
  });

  it('2 行に収まる台詞は警告しない。文中コマンドは字数に入れない', () => {
    const src = withSteps(`    - me: "[wait 8]${'あ'.repeat(16)}\\n${'い'.repeat(16)}"\n`);
    expect(fit(src)).toEqual([]);
  });

  it('3 行になる台詞を、ページの数つきで警告する', () => {
    const ds = fit(withSteps(`    - me: "あ\\nい\\nう"\n`));
    expect(ds).toHaveLength(1);
    expect(ds[0]?.message).toContain('2 ページに分かれます');
    expect(ds[0]?.line).toBe(10);
  });

  it('半角の英数字も 1 字分に数える', () => {
    const ds = fit(withSteps(`    - me: "${'A'.repeat(33)}"\n`));
    expect(ds).toHaveLength(1);
  });

  it('選択肢はボタンの字数を超えたら警告する', () => {
    const long = 'あ'.repeat(FIT.buttonMaxChars + 1);
    const ds = fit(withSteps(`    - choice:\n        - text: ${long}\n        - text: はい\n`));
    expect(ds.map((d) => d.message)).toEqual([expect.stringContaining('選択肢が 18 字')]);
  });

  it('証拠品の名前と説明文の上限を調べる', () => {
    const src = HEAD.replace(
      'a: { name: A, description: "" }',
      `a: { name: ${'証'.repeat(FIT.recordName + 1)}, description: "${'説'.repeat(FIT.descChars * 3 + 1)}" }`,
    );
    const ms = fit(withSteps('').replace(HEAD, src)).map((d) => d.message);
    expect(ms).toEqual([
      expect.stringContaining('証拠品の名前が 11 字'),
      expect.stringContaining('証拠品の説明が 4 行'),
    ]);
  });

  it('証言の題と、証言の文を調べる', () => {
    const src = `${HEAD}    - goto: t
  t:
    testimony: ${'題'.repeat(FIT.testimonyTitle + 1)}
    witness: me
    statements:
      - text: "あ\\nい\\nう"
`;
    const ms = fit(src)
      .map((d) => d.message)
      .filter((m) => /証言の(題|文)/.test(m));
    expect(ms).toEqual([
      expect.stringContaining('証言の題が 17 字'),
      expect.stringContaining('証言の文が 3 行'),
    ]);
  });
});

describe('切り替える説明', () => {
  it('配列の説明も、どの文も点検する', () => {
    const src = `id: t
title: t
characters:
  me: { name: 私 }
evidence:
  a:
    name: A
    description:
      - { when: f, text: "${'あ'.repeat(16 * 4)}" }
      - { text: 短い }
flags: { f: false }
start: { scene: s }
scenes:
  s:
    - if: f
      then: [ { me: a } ]
    - end: true
`;
    const w = fit(src);
    expect(w.some((d) => d.path.join('.') === 'evidence.a.description.0.text')).toBe(true);
  });
});
