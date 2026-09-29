// docs に載せる公式の文の「実例」の書き方と数の決まり。check-quotes.ts が使う。
// 実例は、出典つきの引用の行で書く: > 「文」（蘇る逆転 第1話）
// 話し手を前に付けてもよい: > 裁判長「文」（逆転裁判2 第3話）
// この形の行は一致に数えない。そのかわり、1 つの節（見出しから次の見出しまで）に載せる文は MAX_QUOTED_SENTENCES までにする。

export const MAX_QUOTED_SENTENCES = 5;

const QUOTE =
  /^>\s*[^「」\s]{0,12}「(.+)」（(蘇る逆転|逆転裁判2|逆転裁判3)\s*第\s*\d+\s*話[^）]*）\s*$/;

/** 出典つきの引用の行なら、引用した文を返す（そうでなければ null） */
export function quotedText(line: string): string | null {
  const m = QUOTE.exec(line);
  return m && m[1] !== undefined ? m[1] : null;
}

/** 引用の中の文の数（「。」「！」「？」で区切る。区切りが無くても 1 文） */
export function sentenceCount(text: string): number {
  return Math.max(
    1,
    text.split(/[。！？!?]+/).filter((s) => s.replace(/[\s　‥…」』]/g, '')).length,
  );
}

export interface QuotedSection {
  /** 見出しの行（1 から） */
  line: number;
  heading: string;
  sentences: number;
}

/** 節ごとの引用の文の数。決まりを超えた節だけを返す */
export function overQuotedSections(lines: string[]): QuotedSection[] {
  const out: QuotedSection[] = [];
  let cur: QuotedSection = { line: 1, heading: '（最初の見出しの前）', sentences: 0 };
  let fence = false;
  const flush = () => {
    if (cur.sentences > MAX_QUOTED_SENTENCES) out.push(cur);
  };
  lines.forEach((line, i) => {
    if (line.startsWith('```')) fence = !fence;
    if (fence) return;
    const h = /^#{1,6}\s+(.+)$/.exec(line);
    if (h) {
      flush();
      cur = { line: i + 1, heading: String(h[1]), sentences: 0 };
      return;
    }
    const q = quotedText(line);
    if (q !== null) cur.sentences += sentenceCount(q);
  });
  flush();
  return out;
}
