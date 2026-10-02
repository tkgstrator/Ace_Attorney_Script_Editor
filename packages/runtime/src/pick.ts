// 絵の上の範囲を選ぶ（pick。DS 版の指紋・映像などの遊び）の表示と入力。探索編の「調べる」と同じカーソル・目印で選ぶ。
// 絵が複数あるときは早戻し・早送り（L・R キーか右下のボタン）で切り替える（元のゲームの映像の操作の代わり）。
// 絵が無ければ今の背景の上で選ぶ（範囲は背景の座標なので、スクロールした位置を足して当たりを調べる）。
// 範囲に人物があれば（nominate）、顔を並べて選ぶ（pick-people.ts）
// 16:9 では「やめる」と早戻し・早送りを画面に重ねず、右の欄に出す（panelButtons）
import { type Beat, type Engine, pickMarkers, plainText } from '@gyakusai/core';
import type { BackgroundView } from './background.ts';
import { drawExamineMarkers } from './examine-markers.ts';
import { cursor } from './investigation.ts';
import { hit, type Rect, SCREEN_H, SCREEN_W, UI } from './layout.ts';
import type { Labels } from './options.ts';
import type { Painter } from './painter.ts';
import type { PanelButton } from './panel.ts';
import { drawPeople, isPeople, movePeople, personAt } from './pick-people.ts';
import { type Layout, layoutFor } from './screen.ts';
import * as W from './widgets.ts';

type PickBeat = Extract<Beat, { kind: 'pick' }>;
/** 画面を切り替えた直後の決定を受け付けない時間（押しっぱなしで決定しないように） */
const GUARD_MS = 250;
/** 選べる所（画面の座標） */
const AREA: Rect = { x: 0, y: 0, w: SCREEN_W, h: SCREEN_H };

export class PickUI {
  readonly #panel: boolean;
  /** 今見せている絵（Beat の images の番号） */
  image = 0;
  /** 人物を選ぶときの、選んでいる人物（Beat の areas の番号） */
  person = 0;
  #cursor = { x: SCREEN_W / 2, y: SCREEN_H / 2 - 24 };
  #since = 0;

  constructor(layout: Layout = layoutFor()) {
    this.#panel = layout.panel !== null;
  }

  /** 別の Beat になったら、最初の絵に戻す */
  reset(): void {
    this.image = 0;
    this.person = 0;
    this.#since = performance.now();
  }

  get #guarded(): boolean {
    return performance.now() - this.#since < GUARD_MS;
  }

  /** 画面の左上に当たる絵（背景）の座標。絵が無ければ背景のスクロールした位置 */
  #origin(b: PickBeat, bg: BackgroundView | undefined): [number, number] {
    return b.images.length === 0 && bg ? bg.origin : [0, 0];
  }

  #choose(engine: Engine, b: PickBeat, x: number, y: number, bg: BackgroundView | undefined) {
    if (!hit(AREA, x, y)) return;
    const [ox, oy] = this.#origin(b, bg);
    engine.pickAt(x + ox, y + oy, this.image);
  }

  /** 絵を送る（d = 1）・戻す（d = -1）。端では止まる */
  #turn(b: PickBeat, d: number) {
    this.image = Math.max(0, Math.min(b.images.length - 1, this.image + d));
  }

  key(engine: Engine, b: PickBeat, key: string, bg?: BackgroundView): boolean {
    if ((key === 'Enter' || key === ' ') && this.#guarded) return true;
    if (isPeople(b)) {
      if (key === 'Enter' || key === ' ') engine.pick(this.person);
      else if (key.startsWith('Arrow')) this.person = movePeople(this.person, b.areas.length, key);
      else return false;
      return true;
    }
    const step = UI.cursorStep;
    const c = this.#cursor;
    const a = AREA;
    if (key === 'ArrowLeft') c.x = Math.max(a.x, c.x - step);
    else if (key === 'ArrowRight') c.x = Math.min(a.x + a.w - 1, c.x + step);
    else if (key === 'ArrowUp') c.y = Math.max(a.y, c.y - step);
    else if (key === 'ArrowDown') c.y = Math.min(a.y + a.h - 1, c.y + step);
    else if (key === 'l' || key === 'L') this.#turn(b, -1);
    else if (key === 'r' || key === 'R') this.#turn(b, 1);
    else if (b.quit && (key === 'Escape' || key === 'b' || key === 'B')) engine.pickQuit();
    else if (key === 'Enter' || key === ' ') this.#choose(engine, b, c.x, c.y, bg);
    else return false;
    return true;
  }

  click(engine: Engine, b: PickBeat, x: number, y: number, bg?: BackgroundView): void {
    if (isPeople(b)) {
      const i = personAt(b, x, y);
      if (i === null) return;
      this.person = i;
      if (!this.#guarded) engine.pick(i);
      return;
    }
    if (!this.#panel) {
      if (b.quit && hit(UI.invBack, x, y)) {
        engine.pickQuit();
        return;
      }
      const turn =
        b.images.length > 1 && hit(UI.pickPrev, x, y)
          ? -1
          : b.images.length > 1 && hit(UI.pickNext, x, y)
            ? 1
            : 0;
      if (turn !== 0) {
        this.#turn(b, turn);
        return;
      }
    }
    if (this.#guarded || !hit(AREA, x, y)) return;
    this.#cursor = { x, y };
    this.#choose(engine, b, x, y, bg);
  }

  /** 16:9 の右の欄に出すボタン（早戻し・早送りと「やめる」。人物を選ぶときは無い） */
  panelButtons(engine: Engine, b: PickBeat, labels: Labels): PanelButton[] {
    if (isPeople(b)) return [];
    const out: PanelButton[] = [];
    if (b.images.length > 1) {
      out.push(
        {
          slot: [1, 2],
          half: 'left',
          label: '',
          arrow: 'left',
          enabled: this.image > 0,
          run: () => this.#turn(b, -1),
        },
        {
          slot: [1, 2],
          half: 'right',
          label: '',
          arrow: 'right',
          enabled: this.image < b.images.length - 1,
          run: () => this.#turn(b, 1),
        },
      );
    }
    if (b.quit) out.push({ slot: 4, label: labels.giveUp, run: () => engine.pickQuit() });
    return out;
  }

  /** markers: 選べる範囲の目印を出すか（reduceMotion なら脈打たない。出さないなら null） */
  render(
    p: Painter,
    b: PickBeat,
    labels: Labels,
    frame: number,
    markers: { reduceMotion: boolean } | null,
    bg?: BackgroundView,
    sc?: Engine['scenario'],
  ): void {
    const blinkOn = (frame >> 4) % 2 === 0;
    if (sc && isPeople(b)) {
      drawPeople(p, b, sc, this.person, plainText(b.prompt) || labels.nominateHint, blinkOn);
      return;
    }
    const key = b.images[this.image];
    if (key !== undefined) {
      p.rect(0, 0, SCREEN_W, SCREEN_H, '#000000');
      const img = p.assets.background?.(key);
      if (img) p.ctx.drawImage(img, 0, 0, SCREEN_W, SCREEN_H, 0, 0, SCREEN_W, SCREEN_H);
    }
    const origin = this.#origin(b, bg);
    if (markers) {
      const points = pickMarkers(b.areas, this.image);
      const spots = points.map((point) => ({ point, seen: false }));
      drawExamineMarkers(p, spots, frame, markers.reduceMotion, origin);
    }
    W.textbox(p, null);
    const t = p.fonts.text;
    const prompt = plainText(b.prompt) || labels.pickHint;
    t.draw(t.wrap(prompt, SCREEN_W - 16)[0] ?? '', 8, W.textTop(p), { color: '#ffffff' });
    if (this.#panel) {
      cursor(p, this.#cursor.x, this.#cursor.y, blinkOn ? '#ffffff' : '#f0a020');
      return;
    }
    if (b.quit) p.tab(UI.invBack, 'tr', labels.giveUp);
    if (b.images.length > 1) {
      p.button(
        UI.pickPrev,
        () => {
          p.tab(UI.pickPrev, 'tl', '', { enabled: this.image > 0 });
          arrow(p, UI.pickPrev, 'left');
        },
        this.image > 0,
        'left',
      );
      p.button(
        UI.pickNext,
        () => {
          p.tab(UI.pickNext, 'tl', '', { enabled: this.image < b.images.length - 1 });
          arrow(p, UI.pickNext, 'right');
        },
        this.image < b.images.length - 1,
        'right',
      );
    }
    cursor(p, this.#cursor.x, this.#cursor.y, blinkOn ? '#ffffff' : '#f0a020');
  }
}

/** 早戻し・早送りのボタンの三角（2 つ並べる） */
function arrow(
  p: Painter,
  r: { x: number; y: number; w: number; h: number },
  dir: 'left' | 'right',
) {
  const cx = r.x + 6 + (r.w - 6) / 2,
    cy = r.y + r.h / 2;
  p.triangle(cx - 5, cy, 9, 11, dir, '#ffffff');
  p.triangle(cx + 5, cy, 9, 11, dir, '#ffffff');
}
