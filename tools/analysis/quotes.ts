// docs に載せる公式の文の「実例」の書き方と数の決まり。check-quotes.ts が使う。
// 実例は、出典つきの引用の行で書く: > 「文」（蘇る逆転 第1話）
// 話し手を前に付けてもよい: > 裁判長「文」（逆転裁判2 第3話）
// YAML の例に公式の場面を使うときは、コードブロックの直前に出典の行を置く: > 出典: 蘇る逆転 第2話（法廷1 の始まり）
// この形の行・ブロックは一致に数えない。そのかわり、1 つの節（見出しから次の見出しまで）に載せる文は
// MAX_QUOTED_SENTENCES までにする（ブロックの中の台詞も数える）。

export const MAX_QUOTED_SENTENCES = 5;

const QUOTE =
  /^>\s*[^「」\s]{0,12}「(.+)」（(蘇る逆転|逆転裁判2|逆転裁判3)\s*第\s*\d+\s*話[^）]*）\s*$/;

const SOURCE = /^>\s*出典[:：]\s*(蘇る逆転|逆転裁判2|逆転裁判3)\s*第\s*\d+\s*話/;

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

/** YAML の 1 行の中の台詞の文の数（キー・コメント・文中コマンド・引用符を除き、かな・漢字が残れば数える）。
 * 値の無いキーの後のコメント（`enter:   # 注`）と、コメントだけの行も除く */
export function yamlLineSentences(line: string): number {
  const v = line
    .replace(/^\s*(-\s+)?([A-Za-z_][\w]*:\s*)?/, '')
    .replace(/(^|\s+)#.*$/, '')
    .replace(/\[[a-zA-Z][^\]]*\]/g, '')
    .replace(/\\n/g, '')
    .replace(/^["']|["']$/g, '');
  return /[぀-ヿ一-鿿]/.test(v) ? sentenceCount(v) : 0;
}

/** 出典の行のすぐ後のコードブロックの、中身の行の番号（0 から） */
export function citedBlockLines(lines: string[]): Set<number> {
  const out = new Set<number>();
  let fence = false;
  let cited = false;
  let lastText = '';
  lines.forEach((line, i) => {
    if (line.startsWith('```')) {
      if (!fence) cited = SOURCE.test(lastText);
      fence = !fence;
      return;
    }
    if (fence && cited) out.add(i);
    if (!fence && line.trim()) lastText = line;
  });
  return out;
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
  const cited = citedBlockLines(lines);
  const flush = () => {
    if (cur.sentences > MAX_QUOTED_SENTENCES) out.push(cur);
  };
  lines.forEach((line, i) => {
    if (cited.has(i)) cur.sentences += yamlLineSentences(line);
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
