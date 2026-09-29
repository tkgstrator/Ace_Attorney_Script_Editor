// 決まり文句の許可リスト（tools/analysis/stock-phrases.json）を読み、文に当てる正規表現にする。
// check-quotes.ts（docs に載せてよい句として一致から外す）と phrases.ts（許可リストの句を数えて基準を確かめる）が使う。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface StockPhrase {
  phrase: string;
  /** 決まり文句として使う場面 */
  scene: string;
}

export const STOCK_PATH = join(import.meta.dir, 'stock-phrases.json');

export function loadStockPhrases(): StockPhrase[] {
  const data: { phrases: StockPhrase[] } = JSON.parse(readFileSync(STOCK_PATH, 'utf8'));
  return data.phrases;
}

/** 空白と Markdown・引用の記号を除く（check-quotes.ts の normalize と同じ除き方。文中コマンドは句に無い） */
function strip(s: string): string {
  return s.replace(/[\s　]/g, '').replace(/[*`|#>「」『』（）()]/g, '');
}

/**
 * 句を、そろえた文（normalize の後）に当てる正規表現にする。
 * 「○○」は名前などの差し替える所（1〜20 字）。感嘆符・疑問符は全角と半角のどちらにも当てる。
 * 終わりの句読点（。！？）は無くても当てる（表の中で句読点を省いて書くことがあるため）。
 */
export function stockRegex(phrase: string): RegExp {
  const stripped = strip(phrase);
  const tail = stripped.match(/[。!！?？]$/)?.[0];
  const head = tail ? stripped.slice(0, -1) : stripped;
  const end = tail ? `(?:${tail === '。' ? '。' : /[!！]/.test(tail) ? '[!！]' : '[?？]'})?` : '';
  const body = head
    .split('○○')
    .map((part) =>
      [...part]
        .map((c) => {
          if (c === '!' || c === '！') return '[!！]';
          if (c === '?' || c === '？') return '[?？]';
          return c.replace(/[.*+^${}()|[\]\\]/g, '\\$&');
        })
        .join(''),
    )
    .join('[^。!！?？]{1,20}?');
  return new RegExp(body + end, 'g');
}
