import type { z } from 'zod';

/** zod の検証エラーを、シナリオを書く人向けの日本語にする */
export function describeIssue(issue: z.core.$ZodIssue): string {
  switch (issue.code) {
    case 'unrecognized_keys':
      return `未知のキーです: ${issue.keys.join(', ')}`;
    case 'invalid_type': {
      const key = issue.path.at(-1);
      return /received undefined/.test(issue.message)
        ? `「${String(key)}」がありません（${issue.expected}）`
        : `型が違います（${issue.expected} が必要）`;
    }
    case 'invalid_value':
      return `次のいずれかにしてください: ${issue.values.map((v) => String(v)).join(', ')}`;
    case 'invalid_union': {
      const expected = new Set<string>();
      for (const sub of issue.errors.flat()) {
        if (sub.code === 'invalid_type') expected.add(sub.expected);
        else if (sub.code === 'invalid_value') sub.values.forEach((v) => expected.add(String(v)));
      }
      return expected.size > 0
        ? `次のいずれかの形で書いてください: ${[...expected].join(' / ')}`
        : '書き方が正しくありません';
    }
    case 'too_small':
      return issue.origin === 'array' ? `${issue.minimum} 個以上必要です` : issue.message;
    default:
      return issue.message;
  }
}
