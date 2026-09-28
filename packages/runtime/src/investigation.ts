import { type Beat, type Engine, type ExamineSpot, examineSpots } from '@gyakusai/core';
import type { BackgroundView } from './background.ts';
import { drawExamineMarkers } from './examine-markers.ts';
import { hit, SCREEN_H, SCREEN_W, TOP, UI } from './layout.ts';
import type { Labels } from './options.ts';
import type { Painter } from './painter.ts';
import * as W from './widgets.ts';

type InvestigateBeat = Extract<Beat, { kind: 'investigate' }>;
type View = 'menu' | 'move' | 'talk' | 'examine';
const ACTIONS = ['examine', 'move', 'talk', 'present'] as const;
/** 画面を切り替えた直後の決定を受け付けない時間（押しっぱなしで次の画面まで決定しないように） */
const GUARD_MS = 250;

/**
 * 探索編の探偵メニュー（調べる・移動する・話す・つきつける）の表示と入力。
 * どの画面を開いているか・カーソルの位置などの表示の状態だけを持ち、決定したらエンジンを操作する
 */
export class InvestigationUI {
  view: View = 'menu';
  #sel = 0;
  #cursor = { x: SCREEN_W / 2, y: SCREEN_H / 2 - 24 };
  #since = 0;
  /** 目印を出す所（状態が変わったときだけ計算し直す） */
  #spots: { engine: Engine; serial: number; list: ExamineSpot[] } | null = null;

  #switch(view: View) {
    this.view = view;
    this.#sel = 0;
    this.#since = performance.now();
  }

  get #guarded(): boolean {
    return performance.now() - this.#since < GUARD_MS;
  }

  /** 別の Beat になったら、メニューのトップに戻す */
  reset(): void {
    this.#switch('menu');
  }

  #enabled(b: InvestigateBeat): boolean[] {
    return [b.examine, b.move.length > 0, b.talk.length > 0, b.present];
  }

  #list(b: InvestigateBeat): string[] {
    return this.view === 'move' ? b.move.map((m) => m.name) : b.talk.map((t) => t.topic);
  }

  /** メニューのボタンを選んだとき。つきつけるは法廷記録を開く */
  #action(engine: Engine, b: InvestigateBeat, i: number, openRecord: () => void) {
    if (!this.#enabled(b)[i]) return;
    const a = ACTIONS[i]!;
    if (a === 'present') {
      openRecord();
      return;
    }
    this.#switch(a);
  }

  #pick(engine: Engine, b: InvestigateBeat, i: number) {
    if (this.view === 'move' && b.move[i]) engine.move(b.move[i]!.id);
    else if (this.view === 'talk' && b.talk[i]) engine.talk(b.talk[i]!.id);
  }

  /**
   * 調べるで背景を動かす（元のゲームの L ボタン・下の画面の真ん中のボタン）。場所が許していて、背景が画面より大きく、
   * 端（など決まった位置）にいるときだけ動く
   */
  #slide(engine: Engine, b: InvestigateBeat, bg: BackgroundView | undefined): boolean {
    if (!b.examineScroll || !bg) return false;
    return bg.slide(engine.state.stage.scroll);
  }

  /** 画面の点 → 背景の座標（調べる範囲の座標） */
  #toBackground(x: number, y: number, bg: BackgroundView | undefined): [number, number] {
    return bg ? [x + bg.x, y + bg.y] : [x, y];
  }

  /** bg: 背景の表示（調べる範囲は背景の座標なので、スクロールした位置を足して調べる） */
  key(
    engine: Engine,
    b: InvestigateBeat,
    key: string,
    openRecord: () => void,
    bg?: BackgroundView,
  ): boolean {
    const back = key === 'Escape' || key === 'Backspace';
    if ((key === 'Enter' || key === ' ') && this.#guarded) return true;
    if (this.view === 'menu') {
      if (key === 'ArrowLeft') this.#sel = (this.#sel + 3) % 4;
      else if (key === 'ArrowRight') this.#sel = (this.#sel + 1) % 4;
      else if (key === 'Enter' || key === ' ') this.#action(engine, b, this.#sel, openRecord);
      else if (key === 'x' || key === 'X') openRecord();
      else return false;
      return true;
    }
    if (back) {
      this.#switch('menu');
      return true;
    }
    if (this.view === 'examine') {
      // 背景が動いている間は操作を受け付けない（元のゲームも止まるまで待つ）
      if (bg?.sliding) return true;
      if (key === 'l' || key === 'L') {
        this.#slide(engine, b, bg);
        return true;
      }
      const step = UI.cursorStep;
      const c = this.#cursor;
      if (key === 'ArrowLeft') c.x = Math.max(0, c.x - step);
      else if (key === 'ArrowRight') c.x = Math.min(SCREEN_W - 1, c.x + step);
      else if (key === 'ArrowUp') c.y = Math.max(0, c.y - step);
      else if (key === 'ArrowDown') c.y = Math.min(SCREEN_H - 1, c.y + step);
      else if (key === 'Enter' || key === ' ') engine.examine(...this.#toBackground(c.x, c.y, bg));
      else return false;
      return true;
    }
    const n = this.#list(b).length;
    if (key === 'ArrowUp') this.#sel = (this.#sel + n - 1) % n;
    else if (key === 'ArrowDown') this.#sel = (this.#sel + 1) % n;
    else if (key === 'Enter' || key === ' ') this.#pick(engine, b, this.#sel);
    else return false;
    return true;
  }

  click(
    engine: Engine,
    b: InvestigateBeat,
    x: number,
    y: number,
    openRecord: () => void,
    bg?: BackgroundView,
  ): void {
    if (this.view === 'menu') {
      const i = ACTIONS.findIndex((_, j) => hit(UI.invButton(j), x, y));
      if (i >= 0) this.#action(engine, b, i, openRecord);
      return;
    }
    if (this.view === 'examine' && bg?.sliding) return;
    if (hit(UI.invBack, x, y)) {
      this.#switch('menu');
      return;
    }
    if (this.view === 'examine' && this.#canSlide(b, bg) && hit(UI.examineScroll, x, y)) {
      this.#slide(engine, b, bg);
      return;
    }
    if (this.#guarded) return;
    if (this.view === 'examine') {
      this.#cursor = { x, y };
      engine.examine(...this.#toBackground(x, y, bg));
      return;
    }
    const items = this.#list(b);
    const i = items.findIndex((_, j) => hit(UI.choice(j, items.length), x, y));
    if (i >= 0) this.#pick(engine, b, i);
  }

  /** 背景を動かすボタンを出すか（動いている間も出したままにする） */
  #canSlide(b: InvestigateBeat, bg: BackgroundView | undefined): boolean {
    return !!bg && b.examineScroll && (bg.sliding || bg.slideStep() !== null);
  }

  #spotsOf(engine: Engine): ExamineSpot[] {
    const c = this.#spots;
    if (c?.engine === engine && c.serial === engine.serial) return c.list;
    const list = examineSpots(engine.scenario, engine.state);
    this.#spots = { engine, serial: engine.serial, list };
    return list;
  }

  /** markers: 「調べる」で選べる所の目印を出すとき（出さないなら null）。bg: 背景の表示 */
  render(
    p: Painter,
    b: InvestigateBeat,
    labels: Labels,
    frame: number,
    markers: { engine: Engine; reduceMotion: boolean } | null = null,
    bg?: BackgroundView,
  ): void {
    const blinkOn = (frame >> 4) % 2 === 0;
    // 場所の名前（左上）
    const t = p.fonts.small;
    p.dim({ x: 0, y: 0, w: t.measure(b.name) + 10, h: 14 }, '#000000', 0.55);
    t.draw(b.name, 5, t.centerY(0, 14), { color: '#ffffff' });

    if (this.view === 'menu') {
      W.textbox(p, null);
      const labelsOf = [labels.examine, labels.move, labels.talk, labels.present];
      const enabled = this.#enabled(b);
      ACTIONS.forEach((_, i) => {
        const r = UI.invButton(i);
        p.tab(r, 'bottom', labelsOf[i]!, { small: true, k: 6, enabled: enabled[i] });
        if (i === this.#sel && blinkOn) p.brackets(r);
      });
      return;
    }
    if (this.view === 'examine') {
      W.textbox(p, null);
      const hint = p.fonts.text;
      hint.draw(labels.examineHint, UI.invBack.x + UI.invBack.w + 8, W.textTop(p) + TOP.lineH / 2, {
        color: '#ffffff',
      });
      p.tab(UI.invBack, 'tr', labels.back);
      if (this.#canSlide(b, bg)) scrollButton(p, bg!);
      if (markers) {
        const origin: [number, number] = bg ? [bg.x, bg.y] : [0, 0];
        drawExamineMarkers(p, this.#spotsOf(markers.engine), frame, markers.reduceMotion, origin);
      }
      cursor(p, this.#cursor.x, this.#cursor.y, blinkOn ? '#ffffff' : '#f0a020');
      return;
    }
    p.dim({ x: 0, y: 0, w: SCREEN_W, h: SCREEN_H }, '#000000', 0.45);
    W.choiceButtons(
      p,
      this.#list(b),
      this.#sel,
      blinkOn,
      this.view === 'talk' ? b.talk.map((x) => x.seen) : [],
    );
    p.tab(UI.invBack, 'tr', labels.back);
  }
}

/** 調べるときのカーソル（十字）。背景の上でも見えるよう黒い縁を付ける */
function cursor(p: Painter, x: number, y: number, color: string) {
  const arms: [number, number, number, number][] = [
    [x - 9, y, 6, 1],
    [x + 4, y, 6, 1],
    [x, y - 9, 1, 6],
    [x, y + 4, 1, 6],
  ];
  for (const [ax, ay, w, h] of arms) p.rect(ax - 1, ay - 1, w + 2, h + 2, '#000000');
  for (const [ax, ay, w, h] of arms) p.rect(ax, ay, w, h, color);
}

/** 背景を動かすボタン。動く向きの矢印を描く（動いている間は薄く） */
function scrollButton(p: Painter, bg: BackgroundView) {
  const r = UI.examineScroll;
  const step = bg.slideStep();
  p.tab(r, 'tl', '', { enabled: !bg.sliding });
  if (!step) return;
  const dir = step.x > 0 ? 'right' : step.x < 0 ? 'left' : 'down';
  const cx = r.x + 6 + (r.w - 6) / 2,
    cy = r.y + r.h / 2;
  if (dir === 'down' && step.y < 0) {
    // 上向き（下向きの三角形を上下に反転して描く）
    for (let i = 0; i < 7; i++)
      p.rect(Math.round(cx - i), Math.round(cy - 3 + i), i * 2 + 1, 1, '#ffffff');
    return;
  }
  p.triangle(cx, cy, 10, 13, dir, '#ffffff');
}
