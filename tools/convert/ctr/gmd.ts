// aa-ctr（crates/aa-ctr）・tools/rom/mt_gmd.py が書き出した GMD の文章（script/**/*.txt）を読む。
// 形: 1 行目 "# もとのファイル"、以降 "== 番号 ラベル" の行と、その文（改行を含むことがある）の繰り返し。
import { readFileSync } from 'node:fs';

export type Entry = { label: string | null; text: string };

export function readGmdText(path: string): Entry[] {
  // 台本の文の中の改行は CRLF
  const lines = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const out: Entry[] = [];
  let cur: { label: string | null; lines: string[] } | null = null;
  const flush = () => {
    if (cur) out.push({ label: cur.label, text: cur.lines.join('\n') });
  };
  for (const line of lines.slice(1)) {
    const m = line.match(/^== (\d+)(?: (.*))?$/);
    if (m && Number(m[1]) === out.length + (cur ? 1 : 0)) {
      flush();
      // ラベルに全角の字が混ざっていることがある（Ｌ_PO_START、..._END_０）
      cur = { label: m[2]?.normalize('NFKC') ?? null, lines: [] };
    } else if (cur) cur.lines.push(line);
  }
  if (cur) {
    // ファイルの最後の改行の分
    if (cur.lines.at(-1) === '') cur.lines.pop();
    flush();
  }
  return out;
}

/** ラベルの番号 → 文（ラベルの無いものは null） */
export function labelMap(entries: Entry[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of entries) if (e.label) m.set(e.label, e.text);
  return m;
}

export type Token =
  | { kind: 'text'; text: string }
  | { kind: 'cmd'; name: string; args: number[]; label?: string };

/**
 * 文を命令（<E041 1 0>、<PAGE> など）と文字に分ける。6 には引数が全角数字の命令（<E025 ８>）が少しある。
 * <E033 話 番号 ラベル> だけは最後の引数がラベルの名前（label に入れる）
 */
export function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const re =
    /<(E\d+|[A-Z]+)((?: -?[0-9０-９]+)*)(?: ([A-Za-zＡ-Ｚａ-ｚ_][\w０-９Ａ-Ｚａ-ｚ＿]*))?>/g;
  const half = (s: string) => s.replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xff10));
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    const args = half(m[2]!).trim();
    out.push({
      kind: 'cmd',
      name: m[1]!,
      args: args ? args.split(' ').map(Number) : [],
      ...(m[3] ? { label: m[3].normalize('NFKC') } : {}),
    });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}
