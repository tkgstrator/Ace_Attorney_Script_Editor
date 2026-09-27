import { describe, expect, it } from 'vitest';
import { loadScenario } from './load.ts';

const messages = (yaml: string) => loadScenario(yaml).diagnostics.map(d => `${d.line}:${d.severity === 'error' ? 'E' : 'W'} ${d.message}`);

const HEAD = `id: t
title: t
characters:
  me: { name: 私 }
evidence:
  a: { name: A, description: "" }
flags: { f: false }
start: { scene: s }
scenes:
`;

describe('診断', () => {
  it('未定義の参照を行番号付きで報告する', () => {
    expect(messages(HEAD + `  s:
    - you: やあ
    - give: zz
    - if: g and f
      then: [ { goto: nowhere } ]
    - end: true
`)).toEqual([
      '11:E 「you」はコマンドでも人物 ID でもありません',
      '12:E 未定義の証拠品です: zz',
      '13:E 未定義のフラグです: g（flags に初期値を書いてください）',
      '14:E 未定義のシーンです: nowhere',
    ]);
  });

  it('フラグの型の不一致と未使用を報告する', () => {
    expect(messages(HEAD + `  s:
    - set: { f: 1 }
`)).toEqual([
      '7:W フラグ「f」は一度も参照されていません',
      '11:E フラグ f は boolean 型です（number は入れられません）',
    ]);
  });

  it('コマンドの書き間違いを、そのコマンドの形として報告する', () => {
    expect(messages(HEAD + `  s:
    - say: me
      txt: やあ
    - shout: igiari
    - if: f
`)).toEqual([
      '7:W フラグ「f」は一度も参照されていません', // 壊れた if の条件式は読まれないため
      '11:E 「text」がありません（string）',
      '11:E 未知のキーです: txt',
      '13:E 次のいずれかにしてください: objection, hold, takethat',
      '14:E 「then」がありません（array）',
    ]);
  });

  it('予約語の人物 ID と、どこからも移動しないシーン', () => {
    const yaml = HEAD.replace('me: { name: 私 }', 'me: { name: 私 }\n  goto: { name: x }') + `  s:
    - if: f
      then: [ { end: true } ]
  orphan:
    - me: …
`;
    expect(messages(yaml)).toEqual([
      '5:E 「goto」は予約語なので人物 ID に使えません',
      '15:W シーン「orphan」にはどこからも移動しません',
    ]);
  });

  it('YAML の構文エラー', () => {
    expect(messages('a: [1, 2')[0]).toMatch(/^1:E YAML の構文エラー/);
  });
});
