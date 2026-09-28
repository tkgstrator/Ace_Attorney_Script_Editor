import type { Beat, Engine, InlineCommand } from '@gyakusai/core';
import type { AudioOut } from './audio.ts';
import { BackgroundView } from './background.ts';
import { Blip, blipKindOf } from './blip.ts';
import { ScreenEffects } from './effects.ts';
import { createFonts } from './fonts.ts';
import { InvestigationUI } from './investigation.ts';
import { DOT, FRAME_MS, HEIGHT, TEXT_COLORS, TIMING, WIDTH } from './layout.ts';
import { DEFAULT_LABELS, type Labels, type PlayerOptions } from './options.ts';
import { OverlayView } from './overlays.ts';
import { Painter } from './painter.ts';
import { PanView } from './pan.ts';
import type { LastLine, PlayerHost } from './player-host.ts';
import { click, key } from './player-input.ts';
import { renderScreen } from './player-render.ts';
import { CourtRecord } from './record.ts';
import { LineResume } from './resume.ts';
import { Typewriter } from './typewriter.ts';

/**
 * エンジンの Beat を DS 版のメイン画面風に描き、キーボード・マウス入力をエンジンの操作に変換する。
 * 文字送り・ページ送り・演出・法廷記録の開閉などの表示の状態はここだけで持ち、エンジンには入れない。
 * 入力の処理は player-input.ts、上の画面の描画は player-render.ts に分けてある。
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
  /** 「調べる」で選べる所に目印を出すか（元のゲームにはない手助け。途中で切り替えてよい） */
  examineMarkers: boolean;

  #serial = -1;
  #beat: Beat = { kind: 'end' };
  /** 現在の文を折り返し、linesPerPage 行ずつに分けたもの */
  /** 今の文の文字送り（文のない Beat では null） */
  #tw: Typewriter | null = null;
  #timer = 0;
  #age = 0;
  #choiceSel = 0;
  #lastLine: LastLine | null = null;
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

  /** 入力・描画のモジュール（player-input.ts・player-render.ts）に見せる、この Player の状態 */
  readonly #host: PlayerHost;

  /** #host を作る。定まった部品はそのまま、変わる値は getter で渡す（コンストラクタで部品がそろってから呼ぶ） */
  #makeHost(): PlayerHost {
    const self = this;
    return {
      get engine() {
        return self.engine;
      },
      get beat() {
        return self.#beat;
      },
      p: this.#p,
      labels: this.#labels,
      audio: this.#audio,
      onRestart: this.#onRestart,
      reduceMotion: this.#reduceMotion,
      record: this.#record,
      resume: this.#resume,
      inv: this.#inv,
      fx: this.#fx,
      views: this.#views,
      get tw() {
        return self.#tw;
      },
      get typing() {
        return self.#typing;
      },
      get lastPage() {
        return self.#lastPage;
      },
      get timer() {
        return self.#timer;
      },
      get age() {
        return self.#age;
      },
      get choiceSel() {
        return self.#choiceSel;
      },
      set choiceSel(v: number) {
        self.#choiceSel = v;
      },
      get lastLine() {
        return self.#lastLine;
      },
      get added() {
        return self.#added;
      },
      get lifeShow() {
        return self.#lifeShow;
      },
      get frame() {
        return self.#frame;
      },
      get blink() {
        return self.#blink;
      },
      get markers() {
        return self.examineMarkers
          ? { engine: self.engine, reduceMotion: self.#reduceMotion }
          : null;
      },
    };
  }

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
    this.#host = this.#makeHost();
    this.examineMarkers = opts.examineMarkers ?? true;
    this.#syncBgm();

    const onClick = (e: MouseEvent) => {
      this.#canvas.focus({ preventScroll: true });
      const b = this.#canvas.getBoundingClientRect();
      this.#syncBeat(); // 前のフレームの後にエンジンが進んでいても、最新の Beat に対して操作する
      click(
        this.#host,
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
      if (key(this.#host, e.key)) e.preventDefault();
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
        case 'heal':
          this.#audio?.se('heal');
          this.#lifeShow = TIMING.lifeShowFrames;
          break;
        case 'locks':
          // 錠の演出の音（ID は lock_show / lock_break / lock_unlock。用意されていなければ鳴らない）
          if (ev.fx !== 'hide') this.#audio?.se(`lock_${ev.fx}`);
          if (ev.fx === 'break') this.#effect({ cmd: 'flash', color: 'white', frames: 4 });
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

  // ---- 描画 ------------------------------------------------------------------------

  #render() {
    const ctx = this.#ctx;
    ctx.setTransform(DOT, 0, 0, DOT, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    ctx.save();
    this.#fx.applyShake(ctx);

    renderScreen(this.#host);
    ctx.restore();
    this.#fx.drawFlash(this.#p);
    if (this.#record.open) this.#record.render(this.#p, this.engine, this.#labels, this.#frame);
  }
}
