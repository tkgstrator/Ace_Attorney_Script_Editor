// 今のシーンで画面に出したページだけを覚える。セーブには含めない。
import type { Beat } from '@gyakusai/core';
import { hit, TEXT_COLORS } from './layout.ts';
import type { Labels } from './options.ts';
import type { Painter } from './painter.ts';
import * as R from './record-parts.ts';
import type { Glyph, Typewriter } from './typewriter.ts';

interface Entry {
  name: string | null;
  color: string;
  lines: Glyph[][];
}

// ログを並べる範囲。見出しは出さず、黒い背景に画面いっぱい並べる。4:3 は下に「もどる」の分だけ空ける
const VIEW_WIDE = { x: 4, y: 4, w: 248, h: 184 };
const VIEW_NARROW = { x: 4, y: 4, w: 248, h: 152 };
const BACK = { x: 0, y: 160, w: 80, h: 32 };
const LINE_H = 16;

export class Backlog {
  open = false;
  /** 16:9 か（右の欄に「もどる」があるので、画面の中の「もどる」は出さない） */
  wide = false;
  readonly entries: Entry[] = [];
  #scene: string | null = null;
  #writer: Typewriter | null = null;
  #page = -1;
  #entry: Entry | null = null;
  #offset = 0;
  #dragY: number | null = null;
  #dragged = false;

  get #view() {
    return this.wide ? VIEW_WIDE : VIEW_NARROW;
  }

  reset() {
    this.entries.length = 0;
    this.#writer = null;
    this.#entry = null;
    this.#page = -1;
    this.open = false;
    this.#dragY = null;
    this.#offset = 0;
  }

  syncScene(scene: string) {
    if (scene === this.#scene) return;
    this.reset();
    this.#scene = scene;
  }

  /** 文字送りの途中は同じページを更新する。未表示のページは加えない */
  capture(scene: string, beat: Beat, tw: Typewriter | null) {
    this.syncScene(scene);
    if (!tw || !['line', 'statement', 'card', 'demand'].includes(beat.kind)) return;
    const lines = tw.visible;
    if (!lines.some((row) => row.length > 0)) return;
    if (this.#writer !== tw || this.#page !== tw.page) {
      this.#writer = tw;
      this.#page = tw.page;
      this.#entry = {
        name:
          beat.kind === 'line' || beat.kind === 'statement' || beat.kind === 'demand'
            ? beat.name
            : null,
        color:
          beat.kind === 'line'
            ? TEXT_COLORS[beat.color]
            : beat.kind === 'statement' || beat.kind === 'card'
              ? TEXT_COLORS.green
              : TEXT_COLORS.white,
        lines,
      };
      this.entries.push(this.#entry);
    } else if (this.#entry) this.#entry.lines = lines;
  }

  get #height(): number {
    return this.entries.reduce(
      (sum, e) => sum + (e.name === null ? 0 : LINE_H) + e.lines.length * LINE_H + 12,
      0,
    );
  }

  show() {
    this.open = true;
    this.#dragged = false;
    this.#offset = Math.max(0, this.#height - this.#view.h);
  }

  scroll(delta: number) {
    this.#offset = Math.max(
      0,
      Math.min(Math.max(0, this.#height - this.#view.h), this.#offset + delta),
    );
  }

  key(key: string): boolean {
    if (['Escape', 'b', 'B', 'x', 'X'].includes(key)) this.open = false;
    else if (key === 'ArrowUp' || key === 'ArrowLeft') this.scroll(-32);
    else if (key === 'ArrowDown' || key === 'ArrowRight') this.scroll(32);
    return true;
  }

  click(x: number, y: number) {
    if (this.#dragged) {
      this.#dragged = false;
      return;
    }
    if (!this.wide && hit(BACK, x, y)) this.open = false;
  }

  pointerDown(x: number, y: number) {
    this.#dragged = false;
    if (hit(this.#view, x, y)) this.#dragY = y;
  }

  pointerMove(y: number) {
    if (this.#dragY === null) return;
    const delta = this.#dragY - y;
    if (Math.abs(delta) > 1) this.#dragged = true;
    this.scroll(delta);
    this.#dragY = y;
  }

  pointerUp() {
    this.#dragY = null;
  }

  render(p: Painter, labels: Labels) {
    const VIEW = this.#view;
    p.rect(0, 0, 256, 192, '#000000');
    p.ctx.save();
    p.ctx.beginPath();
    p.ctx.rect(VIEW.x, VIEW.y, VIEW.w, VIEW.h);
    p.ctx.clip();
    let y = VIEW.y - this.#offset;
    for (const e of this.entries) {
      const height = (e.name === null ? 0 : LINE_H) + e.lines.length * LINE_H + 8;
      p.rect(VIEW.x, y, VIEW.w - 3, height, '#182030');
      R.frame(p, { x: VIEW.x, y, w: VIEW.w - 3, h: height });
      let rowY = y + 3;
      if (e.name !== null) {
        p.rect(VIEW.x + 2, rowY - 1, VIEW.w - 7, LINE_H, '#304878');
        p.fonts.small.draw(e.name, VIEW.x + 5, rowY, { color: '#ffffff' });
        rowY += LINE_H;
      }
      for (const row of e.lines) {
        let x = VIEW.x + 5;
        for (const glyph of row) {
          p.fonts.text.draw(glyph.ch, x, rowY, {
            color: glyph.color === null ? e.color : glyph.color,
          });
          x += p.fonts.text.em;
        }
        rowY += LINE_H;
      }
      y += height + 4;
    }
    p.ctx.restore();
    if (!this.wide) p.tab(BACK, 'br', labels.back);
  }
}
