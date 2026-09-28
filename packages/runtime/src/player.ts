import type { Beat, Engine } from '@gyakusai/core';
import { createFonts } from './fonts.ts';
import {
  DOT,
  FRAME_MS,
  HEIGHT,
  SCREEN_H,
  SCREEN_W,
  TEXT_COLORS,
  TIMING,
  TOP,
  UI,
  WIDTH,
  hit,
} from './layout.ts';
import { DEFAULT_LABELS, type Labels, type PlayerOptions } from './options.ts';
import { Painter } from './painter.ts';
import type { AudioOut } from './audio.ts';
import { Blip, blipKindOf } from './blip.ts';
import { ScreenEffects } from './effects.ts';
import { BackgroundView } from './background.ts';
import { OverlayView } from './overlays.ts';
import { PanView } from './pan.ts';
import { drawScene } from './scene.ts';
import { InvestigationUI } from './investigation.ts';
import { CourtRecord } from './record.ts';
import { LineResume } from './resume.ts';
import { drawTopButton, lifeTop, topButtonRect } from './top-buttons.ts';
import { TextRenderer } from './text.ts';
import { Typewriter, type Glyph } from './typewriter.ts';
import type { InlineCommand } from '@gyakusai/core';
import * as W from './widgets.ts';

/**
 * エンジンの Beat を DS 版のメイン画面風に描き、キーボード・マウス入力をエンジンの操作に変換する。
 * 文字送り・ページ送り・演出・法廷記録の開閉などの表示の状態はここだけで持ち、エンジンには入れない。
 */
export class Player {
  engine: Engine;
  readonly #canvas: HTMLCanvasElement;
  readonly #ctx: CanvasRenderingContext2D;
  readonly #p: Painter;
  readonly #labels: Labels;
  readonly #onRestart: (() => void) | undefined;
  readonly #textWidth: number;
  readonly #linesPerPage: number;
  readonly #reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  readonly #record = new CourtRecord();
  readonly #resume = new LineResume();
  readonly #inv = new InvestigationUI();
  readonly #audio: AudioOut | undefined;

  #serial = -1;
  #beat: Beat = { kind: 'end' };
  /** 現在の文を折り返し、linesPerPage 行ずつに分けたもの */
  /** 今の文の文字送り（文のない Beat では null） */
  #tw: Typewriter | null = null;
  #timer = 0;
  #age = 0;
  #choiceSel = 0;
  #lastLine: { name: string | null; lines: Glyph[][]; color: string } | null = null;
  /** 証拠品を入手した直後の台詞の間だけ、詳細の窓を出す */
  #added: string | null = null;
  readonly #fx = new ScreenEffects(this.#reduceMotion);
  readonly #blip = new Blip();
  readonly #views = { bg: new BackgroundView(), overlays: new OverlayView(), pan: new PanView() };
  #lifeShow = 0;
  #frame = 0;
  #blink = 0;
  #nextBlink = 150;
  #raf = 0;
  #last = 0;
  #cleanup: (() => void)[] = [];

  constructor(opts: PlayerOptions) {
    this.engine = opts.engine;
    this.#canvas = opts.canvas;
    this.#canvas.width = WIDTH * DOT;
    this.#canvas.height = HEIGHT * DOT;
    this.#ctx = this.#canvas.getContext('2d')!;
    this.#p = new Painter(this.#ctx, createFonts(this.#ctx, opts), opts.assets ?? {});
    const text = this.#p.fonts.text;
    this.#textWidth = (opts.charsPerLine ?? 16) * text.em - (text.em - text.font.size);
    this.#linesPerPage = opts.linesPerPage ?? 2;
    this.#labels = { ...DEFAULT_LABELS, ...opts.labels };
    this.#onRestart = opts.onRestart;
    this.#audio = opts.audio;
    this.#syncBgm();

    const onClick = (e: MouseEvent) => {
      this.#canvas.focus({ preventScroll: true });
      const b = this.#canvas.getBoundingClientRect();
      this.#syncBeat(); // 前のフレームの後にエンジンが進んでいても、最新の Beat に対して操作する
      this.#click(
        Math.floor(((e.clientX - b.left) / b.width) * WIDTH),
        Math.floor(((e.clientY - b.top) / b.height) * HEIGHT),
      );
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target;
      if (
        t instanceof Element &&
        t !== this.#canvas &&
        t.matches('input, select, textarea, button, [contenteditable]')
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.repeat && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        return;
      } // 押しっぱなしで決定し続けない
      this.#syncBeat();
      if (this.#key(e.key)) e.preventDefault();
    };
    this.#canvas.addEventListener('click', onClick);
    window.addEventListener('keydown', onKey);
    this.#cleanup.push(
      () => this.#canvas.removeEventListener('click', onClick),
      () => window.removeEventListener('keydown', onKey),
    );

    const loop = (t: number) => {
      const dt = Math.min(50, t - (this.#last || t));
      this.#last = t;
      this.#update(dt);
      this.#render();
      this.#raf = requestAnimationFrame(loop);
    };
    this.#raf = requestAnimationFrame(loop);
  }

  /** 別のエンジン（最初から・ロード）に差し替える */
  setEngine(engine: Engine): void {
    this.engine = engine;
    this.#serial = -1;
    this.#record.open = false;
    this.#lastLine = null;
    this.#added = null;
    this.#lifeShow = 0;
    this.#syncBgm(); // ロードしたら、その時点の BGM を流し直す
  }

  /** 状態の BGM（と一時停止）に合わせる */
  #syncBgm() {
    const { bgm, bgmPaused } = this.engine.state.stage;
    this.#audio?.bgm(bgm, 0);
    if (bgmPaused) this.#audio?.pause?.(0);
  }

  destroy(): void {
    cancelAnimationFrame(this.#raf);
    for (const fn of this.#cleanup) fn();
  }

  // ---- 文字送り・ページ送り -------------------------------------------------------

  get #typing(): boolean {
    return this.#tw?.typing ?? false;
  }
  get #lastPage(): boolean {
    return this.#tw?.lastPage ?? true;
  }

  #typewriter(text: string): Typewriter {
    return new Typewriter(text, {
      wrap: (t) => this.#p.fonts.text.wrap(t, this.#textWidth),
      linesPerPage: this.#linesPerPage,
      colors: TEXT_COLORS,
      autoPause: this.engine.scenario.autoPause,
      onCommand: (c) => this.#effect(c),
      onChar: (speed) => {
        const id = this.#blip.char(speed);
        if (id) this.#audio?.se(id);
      },
    });
  }

  /** 揺れ・フラッシュ・音（台詞の途中の命令と、ステップの命令の両方から） */
  #effect(c: InlineCommand) {
    switch (c.cmd) {
      case 'shake':
        this.#fx.shake(c.frames, c.strength);
        break;
      case 'flash':
        this.#fx.flash(c.color, c.frames);
        break;
      case 'se':
        this.#audio?.se(c.id);
        break;
      case 'bgm':
        this.#audio?.bgm(c.id, c.frames * FRAME_MS);
        break;
      // 文の途中の人物・背景の切り替えは、その文字まで来たところで状態に反映する
      case 'show':
      case 'location':
        this.engine.applyInline(c);
        break;
      case 'blip':
        this.#blip.command(c.kind);
        break;
      default:
        break; // native（未対応の元の命令）は何もしない
    }
  }

  // ---- 更新 ------------------------------------------------------------------------

  #syncBeat() {
    if (this.engine.serial === this.#serial) return;
    this.#serial = this.engine.serial;
    const beat = this.engine.beat;
    this.#beat = beat;
    this.#timer = 0;
    this.#age = 0;
    this.#choiceSel = 0;
    this.#inv.reset();
    if (!this.engine.canPresent) this.#record.open = false;
    const text =
      beat.kind === 'line' || beat.kind === 'statement' || beat.kind === 'card'
        ? beat.text
        : beat.kind === 'demand'
          ? beat.prompt
          : null;
    this.#blip.reset(blipKindOf(this.engine.scenario, beat));
    this.#tw = text !== null ? this.#typewriter(text) : null;
    this.#resume.apply(this.engine, beat, this.#tw);
    if (beat.kind === 'line' && this.#tw) {
      // 選択肢を出すときは、直前の台詞の最後のページを残して表示する
      this.#lastLine = {
        name: beat.name,
        lines: this.#tw.pages.at(-1)?.lines ?? [],
        color: TEXT_COLORS[beat.color],
      };
    }
    this.#added = null;
    if (beat.kind === 'shout') this.#audio?.se(`shout_${beat.shout}`); // 吹き出しの声（効果音の ID は shout_objection など）
    for (const ev of this.engine.drainEvents()) {
      switch (ev.type) {
        case 'penalty':
          this.#audio?.se('damage');
          this.#effect({ cmd: 'flash', color: 'red', frames: 8 });
          this.#effect({ cmd: 'shake', frames: 16, strength: 0 });
          this.#lifeShow = TIMING.lifeShowFrames;
          break;
        case 'evidence':
          if (ev.added) this.#added = ev.id;
          break;
        case 'bgm':
          this.#effect({ cmd: 'bgm', id: ev.id, frames: ev.frames });
          break;
        case 'se':
          this.#effect({ cmd: 'se', id: ev.id });
          break;
        case 'shake':
          this.#effect({ cmd: 'shake', frames: ev.frames, strength: ev.strength });
          break;
        case 'flash':
          this.#effect({ cmd: 'flash', color: ev.color, frames: ev.frames });
          break;
        case 'fade':
          this.#fx.fade(ev.dir, ev.color, ev.frames);
          break;
        case 'charFade':
          this.#fx.charFade = { ...ev, elapsed: 0 };
          break;
        case 'bgmPause':
          if (ev.pause) this.#audio?.pause?.(ev.frames * FRAME_MS);
          else this.#audio?.resume?.(ev.frames * FRAME_MS);
          break;
      }
    }
  }

  #update(dt: number) {
    this.#syncBeat();
    this.#frame++;
    this.#age += dt;
    this.#fx.tick();
    this.#views.bg.tick(this.engine.state.stage.scroll);
    this.#views.overlays.tick();
    this.#views.pan.tick(this.engine.state.stage.pan);
    if (this.#lifeShow > 0) this.#lifeShow--;
    if (this.#blink > 0) this.#blink--;
    else if (--this.#nextBlink <= 0) {
      this.#blink = 6;
      this.#nextBlink = 120 + Math.floor(Math.random() * 150);
    }

    const b = this.#beat;
    if (b.kind === 'shout' || b.kind === 'banner' || b.kind === 'fade' || b.kind === 'wait') {
      this.#timer += dt;
      const ms =
        b.kind === 'shout'
          ? TIMING.shoutMs
          : b.kind === 'banner'
            ? TIMING.bannerMs
            : b.frames * FRAME_MS;
      if (this.#timer >= ms) this.engine.advance();
      return;
    }
    this.#tw?.tick(dt);
    // auto の台詞は、出し終えたらボタンを待たずに進む
    if (b.kind === 'line' && b.auto && !this.#typing && this.#lastPage) this.engine.advance();
  }

  // ---- 入力 ------------------------------------------------------------------------

  #confirm() {
    const b = this.#beat;
    if (this.#typing) {
      this.#tw?.finish();
      return;
    }
    // ページ送り・選択肢の決定の音（元のゲームの SE 0x2f / 0x2b。ID は ui_page / ui_decide）
    if (!this.#lastPage) {
      this.#audio?.se('ui_page');
      this.#tw?.nextPage();
      return;
    }
    switch (b.kind) {
      case 'line':
      case 'statement':
      case 'card':
        this.#audio?.se('ui_page');
        this.engine.advance();
        break;
      case 'banner':
        this.engine.advance();
        break;
      case 'demand':
        this.#record.show(this.engine, 'evidence');
        break;
      case 'choice':
        if (this.#age >= TIMING.choiceGuardMs) {
          this.#audio?.se('ui_decide');
          this.engine.choose(this.#choiceSel);
        }
        break;
      case 'end':
      case 'gameover':
        if (this.#age >= TIMING.endGuardMs) this.#onRestart?.();
        break;
      case 'shout':
      case 'investigate':
      case 'fade':
      case 'wait':
        break;
    }
  }

  get #onCross(): boolean {
    const b = this.#beat;
    return b.kind === 'statement' && b.cross;
  }

  /** 法廷記録を開けるか */
  get #canOpenRecord(): boolean {
    const k = this.#beat.kind;
    if (this.engine.state.stage.recordLocked) return false;
    if (k === 'investigate') return this.#inv.view === 'menu';
    return k === 'line' || k === 'statement' || k === 'choice' || k === 'demand' || k === 'card';
  }

  /** 法廷記録の操作。台詞の途中で詳しく調べ始めたら、戻ったときに続きから見せるため覚える */
  #onRecord<T>(fn: () => T): T {
    const [before, page] = [this.#beat, this.#tw?.page ?? 0];
    const out = fn();
    this.#resume.remember(this.engine, before, page);
    return out;
  }

  #pressStatement() {
    const b = this.#beat;
    if (b.kind === 'statement' && b.canPress) this.engine.press();
  }

  #key(key: string): boolean {
    if (this.#record.open) return this.#onRecord(() => this.#record.key(this.engine, key));
    const b = this.#beat;
    if (b.kind === 'investigate')
      return this.#inv.key(this.engine, b, key, () => this.#record.show(this.engine, 'evidence'));
    if (b.kind === 'choice' && !this.#typing) {
      const n = b.options.length;
      if (key === 'ArrowUp') {
        this.#choiceSel = (this.#choiceSel + n - 1) % n;
        this.#audio?.se('ui_select');
        return true;
      }
      if (key === 'ArrowDown') {
        this.#choiceSel = (this.#choiceSel + 1) % n;
        this.#audio?.se('ui_select');
        return true;
      }
    }
    if (key === 'Enter' || key === ' ') this.#confirm();
    else if ((key === 'x' || key === 'X') && this.#canOpenRecord) this.#record.show(this.engine);
    else if (this.#onCross && (key === 'z' || key === 'Z')) this.#pressStatement();
    else if (this.#onCross && key === 'ArrowRight') this.#confirm();
    else if (this.#onCross && key === 'ArrowLeft') this.engine.back();
    else return false;
    return true;
  }

  #click(x: number, y: number) {
    if (this.#record.open) {
      this.#onRecord(() => this.#record.click(this.engine, x, y));
      return;
    }
    const b = this.#beat;
    const recordAt = topButtonRect(this.#p, 'record');
    if (b.kind === 'investigate' && !(this.#canOpenRecord && hit(recordAt, x, y))) {
      this.#inv.click(this.engine, b, x, y, () => this.#record.show(this.engine, 'evidence'));
      return;
    }
    if (this.#canOpenRecord && hit(recordAt, x, y)) {
      this.#record.show(this.engine, 'evidence');
      return;
    }
    if (this.#onCross) {
      if (hit(topButtonRect(this.#p, 'press'), x, y)) {
        this.#pressStatement();
        return;
      }
      if (hit(topButtonRect(this.#p, 'present'), x, y)) {
        this.#record.show(this.engine, 'evidence');
        return;
      }
    }
    if (b.kind === 'choice') {
      if (this.#typing) {
        this.#confirm();
        return;
      }
      const i = b.options.findIndex((_, j) => hit(UI.choice(j, b.options.length), x, y));
      if (i >= 0 && this.#age >= TIMING.choiceGuardMs) {
        this.#audio?.se('ui_decide');
        this.engine.choose(i);
      }
      return;
    }
    this.#confirm();
  }

  // ---- 描画 ------------------------------------------------------------------------

  #render() {
    const ctx = this.#ctx;
    ctx.setTransform(DOT, 0, 0, DOT, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.save();
    this.#fx.applyShake(ctx);

    this.#renderScreen();
    ctx.restore();
    this.#fx.drawFlash(this.#p);
    if (this.#record.open) this.#record.render(this.#p, this.engine, this.#labels, this.#frame);
  }

  #renderScreen() {
    const p = this.#p;
    const b = this.#beat;
    const blinkOn = (this.#frame >> 4) % 2 === 0;
    const arrow = () => {
      if (!this.#typing) W.nextArrow(p, this.#frame);
    };
    const typed = () => this.#tw?.visible ?? [];
    const full = () => this.#tw?.full ?? [];

    if (b.kind === 'card') {
      p.rect(0, 0, SCREEN_W, SCREEN_H, '#000000');
      W.textbox(p, null);
      W.centeredGlyphs(p, typed(), full(), TEXT_COLORS.green, W.textTop(p));
      arrow();
      return;
    }

    drawScene(
      this.#p,
      this.engine,
      b,
      { typing: this.#typing, frame: this.#frame, blink: this.#blink > 0 },
      this.#fx,
      this.#views,
    );

    if (b.kind === 'choice') {
      p.dim({ x: 0, y: 0, w: SCREEN_W, h: SCREEN_H }, '#000000', 0.45);
      const last = this.#lastLine;
      W.textbox(p, last?.name ?? null, TOP.choiceBox);
      if (last) W.bodyText(p, last.lines, last.color, TOP.choiceBox);
      W.choiceBand(p, this.#labels.choicePrompt);
      W.choiceButtons(p, b.options, this.#choiceSel, blinkOn);
      return;
    }

    const stage = this.engine.state.stage;
    if (stage.evidence && b.kind !== 'banner' && b.kind !== 'shout')
      W.thumbnail(
        p,
        stage.evidence,
        this.engine.scenario.evidence[stage.evidence],
        stage.evidenceRight,
      );
    const added = this.#added ? this.engine.scenario.evidence[this.#added] : undefined;
    if (this.#added && added) W.addedWindow(p, this.#added, added);
    if (b.kind === 'statement' && !b.cross)
      p.fonts.text.draw(this.#labels.testifying, 3, 3, { color: '#48e048', outline: '#0c300c' });
    const gauge = stage.lifeGauge ?? (this.#onCross || b.kind === 'demand');
    if (gauge || this.#lifeShow > 0)
      W.lifeMarks(p, this.engine.state.life, this.engine.scenario.maxLife, lifeTop(p));
    if (this.#canOpenRecord) drawTopButton(p, 'record', this.#labels);
    if (b.kind === 'statement' && b.cross) {
      drawTopButton(p, 'press', this.#labels, b.canPress);
      drawTopButton(p, 'present', this.#labels);
    }

    switch (b.kind) {
      case 'line':
      case 'statement':
      case 'demand': {
        const color =
          b.kind === 'line'
            ? TEXT_COLORS[b.color]
            : b.kind === 'statement'
              ? TEXT_COLORS.green
              : TEXT_COLORS.white;
        if (stage.textbox !== false) W.textbox(p, b.name);
        W.bodyText(p, typed(), color);
        arrow();
        break;
      }
      case 'wait':
      case 'fade':
        if (stage.textbox === true) W.textbox(p, null); // 枠を出したまま待つ（元のゲームの box 0 の後の待ち）
        break;
      case 'banner': {
        const slide = this.#reduceMotion ? 1 : Math.min(1, this.#timer / 200);
        if (b.sub) {
          W.textbox(p, null);
          W.centeredText(p, [b.sub], [b.sub], TEXT_COLORS.orange, W.textTop(p) + TOP.lineH / 2);
        }
        W.bigText(p, b.text, b.sub ? 56 : 72, slide);
        break;
      }
      case 'shout': {
        const img = p.assets.shout?.(b.shout);
        if (img) p.ctx.drawImage(img, 0, 0, SCREEN_W, SCREEN_H);
        else W.bubble(p, b.shout, this.#reduceMotion ? 1 : Math.min(1, this.#timer / 120));
        break;
      }
      case 'investigate':
        this.#inv.render(p, b, this.#labels, this.#frame);
        break;
      case 'end':
        W.endScreen(p, this.#labels.end);
        break;
      case 'gameover':
        W.endScreen(p, this.#labels.gameover);
        break;
    }
  }
}
