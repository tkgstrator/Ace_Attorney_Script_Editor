// 公式の文の実例（出典つきの引用）の見分けと、節ごとの数の決まりのテスト
import { describe, expect, it } from 'vitest';
import {
  citedBlockLines,
  MAX_QUOTED_SENTENCES,
  overQuotedSections,
  quotedText,
  sentenceCount,
  yamlLineSentences,
} from '../quotes.ts';

describe('出典つきの引用', () => {
  it('「文」（作品 第N話）の行を引用として読む', () => {
    expect(quotedText('> 「これは例です。」（蘇る逆転 第2話）')).toBe('これは例です。');
    expect(quotedText('> 裁判長「静かに！」（逆転裁判3 第1話）')).toBe('静かに！');
  });

  it('出典の無い行・引用の記号の無い行は引用にしない', () => {
    expect(quotedText('> 「これは例です。」')).toBeNull();
    expect(quotedText('「これは例です。」（蘇る逆転 第2話）')).toBeNull();
    expect(quotedText('> 「これは例です。」（別の作品 第2話）')).toBeNull();
  });

  it('文の数は句点・感嘆符・疑問符で区切って数える', () => {
    expect(sentenceCount('はい。そうです！本当に？')).toBe(3);
    expect(sentenceCount('‥‥')).toBe(1);
    expect(sentenceCount('言いかけて‥‥')).toBe(1);
  });
});

describe('節ごとの実例の数', () => {
  const q = (n: number) => Array.from({ length: n }, (_, i) => `> 「例${i}。」（逆転裁判2 第1話）`);

  it(`${MAX_QUOTED_SENTENCES} 文までなら何も出さない`, () => {
    expect(overQuotedSections(['# 節', ...q(MAX_QUOTED_SENTENCES)])).toEqual([]);
  });

  it('超えた節を、見出しの行と文の数つきで返す', () => {
    const lines = ['# 一', ...q(2), '## 二', ...q(MAX_QUOTED_SENTENCES + 1)];
    expect(overQuotedSections(lines)).toEqual([
      { line: 4, heading: '二', sentences: MAX_QUOTED_SENTENCES + 1 },
    ]);
  });

  it('コードブロックの中の見出しや引用は数えない', () => {
    const lines = ['# 一', '```', '# 見出しではない', ...q(9), '```', ...q(1)];
    expect(overQuotedSections(lines)).toEqual([]);
  });
});

describe('出典つきの YAML の例', () => {
  const block = [
    '## 節',
    '> 出典: 蘇る逆転 第2話（法廷1 の始まり）',
    '',
    '```yaml',
    '- se: SE010',
    '- judge: "これは例です。[wait 8]\\n次の文です。"',
    '```',
  ];

  it('出典の行の直後のブロックの中身だけを実例にする', () => {
    expect([...citedBlockLines(block)]).toEqual([4, 5]);
    expect(citedBlockLines(['```yaml', '- a: 例', '```'])).toEqual(new Set());
  });

  it('台詞の文を数え、キーや命令だけの行は数えない', () => {
    expect(yamlLineSentences('- se: SE010')).toBe(0);
    expect(yamlLineSentences('- judge: "これは例です。[wait 8]\\n次の文です。"')).toBe(2);
    expect(yamlLineSentences('  text: （心の声‥‥）  # 注')).toBe(1);
  });

  it('ブロックの中の文も節の数に入れる', () => {
    const lines = [
      ...block,
      '> 「一。二。三。」（逆転裁判3 第1話）',
      '> 「四。」（逆転裁判3 第1話）',
    ];
    expect(overQuotedSections(lines)).toEqual([{ line: 1, heading: '節', sentences: 6 }]);
  });
});
