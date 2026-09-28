// 台詞の文を、文中コマンド（[wait 8] など）と文字に分ける。

export interface Command {
  name: string;
  args: string[];
  /** 何文字目（改行を除いた、表示される文字の数）の所か */
  pos: number;
  /** 何行目（0 から）か */
  line: number;
}

export interface Parsed {
  /** コマンドを除いた文（改行つき） */
  plain: string;
  /** 行ごとの文 */
  lines: string[];
  /** 表示される文字の数（改行を除く） */
  chars: number;
  commands: Command[];
  /** 文字ごとの色（改行を除く。plain から改行を除いた並びと同じ長さ） */
  colors: string[];
}

export function parseText(raw: string, startColor = 'white'): Parsed {
  let plain = '';
  let chars = 0;
  let line = 0;
  let color = startColor;
  const colors: string[] = [];
  const commands: Command[] = [];
  for (let i = 0; i < raw.length; ) {
    const c = raw[i] as string;
    if (c === '[' && raw[i + 1] === '[') {
      plain += '[';
      colors.push(color);
      chars++;
      i += 2;
      continue;
    }
    if (c === '[') {
      const end = raw.indexOf(']', i);
      if (end > 0) {
        const [name = '', ...args] = raw
          .slice(i + 1, end)
          .trim()
          .split(/\s+/);
        commands.push({ name, args, pos: chars, line });
        if (name === 'color') color = args[0] ?? 'white';
        i = end + 1;
        continue;
      }
    }
    plain += c;
    if (c === '\n') line++;
    else {
      colors.push(color);
      chars++;
    }
    i++;
  }
  return { plain, lines: plain.split('\n'), chars, commands, colors };
}

/** 句読点・記号の分類（数えるときの名前 → 文字の集まり） */
export const MARKS: Record<string, RegExp> = {
  '！': /[!！]/g,
  '？': /[?？]/g,
  '‥‥': /‥+/g,
  '…': /…+/g,
  '、': /、/g,
  '。': /。/g,
  'ッ（小さいツ）': /[ッっ]/g,
  'ー（長音）': /ー/g,
  '〜': /[〜～]/g,
  '“”': /[“”]/g,
  '「」': /[「」]/g,
  '《》': /[《》]/g,
  '（）': /[（）()]/g,
  '♪': /♪/g,
};

export function countMatches(s: string, re: RegExp): number {
  return s.match(re)?.length ?? 0;
}

/** 文字の種類 */
export function charClass(
  c: string,
): 'kanji' | 'hira' | 'kata' | 'ascii' | 'digit' | 'punct' | 'space' {
  if (/[一-鿿々〆]/.test(c)) return 'kanji';
  if (/[ぁ-ゟ]/.test(c)) return 'hira';
  if (/[ァ-ヺー]/.test(c)) return 'kata';
  if (/[0-9０-９]/.test(c)) return 'digit';
  if (/[a-zA-Zａ-ｚＡ-Ｚ]/.test(c)) return 'ascii';
  if (/[\s　]/.test(c)) return 'space';
  return 'punct';
}

/** 全角 1、半角 0.5 として数えた行の幅 */
export function lineWidth(s: string): number {
  let w = 0;
  for (const c of s) w += /[\x20-\x7e]/.test(c) ? 0.5 : 1;
  return w;
}
