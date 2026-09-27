// 文字送り。台詞を折り返してページに分け、1 文字ずつ出しながら、文中コマンド（待つ・速さ・色・揺れ・
// フラッシュ・音）をその文字の位置で実行する。時間の単位は元のゲームと同じフレーム（1/60 秒）。
import { parseRich, type InlineCommand } from '@gyakusai/core';

/** 1 文字を出す間隔の既定（フレーム） */
export const DEFAULT_CHAR_FRAMES = 3;
const FRAME_MS = 1000 / 60;

export interface Glyph {
  ch: string;
  /** 文中の [color] で変えた色。null なら台詞の既定の色 */
  color: string | null;
}

interface Page {
  lines: Glyph[][];
  /** ページの何文字目の前で実行するか → コマンド（ページの文字数と同じ番号は、最後の文字の後） */
  events: Map<number, InlineCommand[]>;
  length: number;
}

export interface TypewriterOptions {
  /** 折り返し（改行以外の文字は落とさないこと） */
  wrap: (plain: string) => string[];
  linesPerPage: number;
  colors: Record<string, string>;
  /** 句読点のあとで自動的に待つか */
  autoPause: boolean;
  /** 待つ・速さ・色以外のコマンドを実行する（揺れ・フラッシュ・音） */
  onCommand: (c: InlineCommand) => void;
  /** 1 文字出すたびに呼ぶ（文字送りの音に使う）。speed はその時の 1 文字の間隔 */
  onChar?: (speed: number) => void;
}

export class Typewriter {
  readonly pages: Page[];
  page = 0;
  /** 今のページで出した文字数 */
  shown = 0;
  #opts: TypewriterOptions;
  #speed = DEFAULT_CHAR_FRAMES;
  #acc = 0;
  #wait = 0;
  #fired = -1;

  constructor(text: string, opts: TypewriterOptions) {
    this.#opts = opts;
    let rich;
    try { rich = parseRich(text); } catch { rich = { plain: text, marks: [] }; }
    const byIndex = new Map<number, InlineCommand[]>();
    for (const m of rich.marks) byIndex.set(m.at, [...(byIndex.get(m.at) ?? []), m.command]);
    const chars = [...rich.plain];
    // 各文字の色を先に決める（ページをまたいでも続く）
    const colorAt: (string | null)[] = [];
    let color: string | null = null;
    for (let i = 0; i <= chars.length; i++) {
      for (const c of byIndex.get(i) ?? []) if (c.cmd === 'color') color = c.color === 'white' ? null : opts.colors[c.color] ?? null;
      colorAt.push(color);
    }
    // 折り返した行を、元の文字の位置と対応づけながらページに分ける
    const lines = opts.wrap(rich.plain);
    this.pages = [];
    let src = 0;
    for (let l = 0; l < lines.length; l += opts.linesPerPage) {
      const page: Page = { lines: [], events: new Map(), length: 0 };
      for (const line of lines.slice(l, l + opts.linesPerPage)) {
        const row: Glyph[] = [];
        for (const ch of line) {
          while (chars[src] === '\n' && ch !== '\n') src++;
          const ev = byIndex.get(src);
          if (ev) page.events.set(page.length, ev);
          row.push({ ch, color: colorAt[src] ?? null });
          page.length++;
          src++;
        }
        page.lines.push(row);
      }
      while (chars[src] === '\n') src++;
      this.pages.push(page);
    }
    // 最後の文字の後のコマンド
    const tail = byIndex.get(chars.length);
    const last = this.pages.at(-1);
    if (tail && last) last.events.set(last.length, [...(last.events.get(last.length) ?? []), ...tail]);
    if (this.pages.length === 0) this.pages.push({ lines: [], events: tail ? new Map([[0, tail]]) : new Map(), length: 0 });
  }

  get #cur(): Page { return this.pages[this.page]!; }
  get typing(): boolean { return this.shown < this.#cur.length || this.#fired < this.#cur.length && this.#cur.events.has(this.#cur.length) || this.#wait > 0; }
  get lastPage(): boolean { return this.page >= this.pages.length - 1; }

  /** 今のページで出ている文字（行ごと） */
  get visible(): Glyph[][] {
    let left = this.shown;
    return this.#cur.lines.map(row => { const r = row.slice(0, Math.max(0, left)); left -= row.length; return r; });
  }

  /** ページの全部の文字（中央寄せの位置合わせなどに使う） */
  get full(): Glyph[][] { return this.#cur.lines; }

  /** 経過時間だけ文字を進める */
  tick(ms: number): void {
    this.#acc += ms / FRAME_MS;
    for (let guard = 0; guard < 1000; guard++) {
      if (this.#wait > 0) {
        const used = Math.min(this.#wait, this.#acc);
        this.#wait -= used;
        this.#acc -= used;
        if (this.#wait > 0) return;
      }
      if (this.#fire(this.shown)) continue; // [wait] で待ちが入ったら、上で待つ
      if (this.shown >= this.#cur.length) { this.#acc = 0; return; }
      const cost = this.#speed + this.#pause(this.shown - 1);
      if (this.#acc < cost) return;
      this.#acc -= cost;
      this.shown++;
      this.#opts.onChar?.(this.#speed);
    }
  }

  /** 文字送りを飛ばして、ページの最後まで出す（BGM・人物・背景の切り替えだけは実行する） */
  finish(): void {
    const page = this.#cur;
    for (let i = this.#fired + 1; i <= page.length; i++) {
      for (const c of page.events.get(i) ?? []) {
        if (c.cmd === 'bgm' || c.cmd === 'show' || c.cmd === 'location') this.#opts.onCommand(c);
      }
    }
    this.#fired = page.length;
    this.shown = page.length;
    this.#wait = 0;
  }

  nextPage(): void {
    this.page++;
    this.shown = 0;
    this.#acc = 0;
    this.#fired = -1;
  }

  /** index の文字の前のコマンドを 1 度だけ実行する。待つコマンドがあれば true */
  #fire(index: number): boolean {
    if (this.#fired >= index) return false;
    this.#fired = index;
    let waited = false;
    for (const c of this.#cur.events.get(index) ?? []) {
      if (c.cmd === 'wait') { this.#wait += c.frames; waited = true; }
      else if (c.cmd === 'speed') this.#speed = c.frames;
      else if (c.cmd !== 'color') this.#opts.onCommand(c);
    }
    return waited;
  }

  /** 句読点のあとの自動の待ち（autoPause のときだけ） */
  #pause(prevIndex: number): number {
    if (!this.#opts.autoPause || prevIndex < 0) return 0;
    const ch = this.#cur.lines.flat()[prevIndex]?.ch ?? '';
    return '。！？'.includes(ch) ? 9 : '、…'.includes(ch) ? 4 : 0;
  }
}
