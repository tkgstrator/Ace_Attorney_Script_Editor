// 背景の表示位置とスクロール。画面より大きい背景は、表示位置から画面の大きさだけ切り出して描く。
// 元のゲームと同じく、背景を変えると最初の位置（縦長なら下端など）に戻り、スクロールは毎フレーム速さの分だけ動いて端で止まる。
//
// 広い画面（16:9）での見せ方:
//   - 画面より広い背景は、見える幅いっぱいに見せる。最初の位置は、4:3 の画面の中央と同じ所が画面の中央に来るように
//     ずらし、背景の端を越えないように詰める。スクロールの端も見える幅で決める
//   - 4:3 の画面の幅（256）以下の背景は、4:3 の枠（画面の中央）に置き、左右は黒のまま
//   - その間の幅の背景は、画面の中央に置く
// 人物・重ね絵は 4:3 の枠の座標で描くので、背景の中の同じ所に来るように offset だけずらす。
import { type BackgroundPos, examineScrollStep } from './examine-scroll.ts';
import { type Rect, SCREEN_H, SCREEN_W } from './layout.ts';
import { type Layout, layoutFor } from './screen.ts';

type Scroll = { x: number; y: number } | null;

/** 1 つの向きの置き方。pad: 背景の左端（上端）を置く画面の位置、max: スクロールの端 */
function axis(len: number, screen: number, frame: number, off: number) {
  if (len >= screen) return { pad: 0, max: len - screen };
  return { pad: len <= frame ? off : Math.floor((screen - len) / 2), max: 0 };
}

export class BackgroundView {
  readonly #L: Layout;
  #key: string | null = null;
  #image: CanvasImageSource | null = null;
  /** 画面の左上に見えている背景の座標（画面より狭い向きでは 0） */
  x = 0;
  y = 0;
  /** 背景を変えたときの位置（4:3 の画面の左上の座標。人物・重ね絵は、ここからスクロールした分だけ一緒にずれる） */
  #startX = 0;
  #startY = 0;

  constructor(layout: Layout = layoutFor()) {
    this.#L = layout;
  }

  #axes() {
    const { w, h } = this.#image ? size(this.#image) : { w: SCREEN_W, h: SCREEN_H };
    return {
      w,
      h,
      ax: axis(w, this.#L.w, SCREEN_W, this.#L.ox),
      ay: axis(h, this.#L.h, SCREEN_H, 0),
    };
  }

  /** 今の背景に合わせる。背景が変わったら最初の位置に戻す */
  sync(
    key: string,
    image: CanvasImageSource | undefined,
    start: [number, number] | undefined,
  ): void {
    if (key === this.#key && image === this.#image) return;
    const changed = key !== this.#key;
    this.#key = key;
    this.#image = image ?? null;
    if (changed || !this.#started) {
      [this.#startX, this.#startY] = start ?? [0, 0];
      this.x = this.#startX;
      this.y = this.#startY;
      // 広い画面では、4:3 の画面の中央と同じ所を中央に置き、背景の端を越えないように詰める
      if (this.#L.ox > 0) {
        const { ax, ay } = this.#axes();
        this.x = clamp(this.#startX - this.#L.ox, ax.max);
        this.y = clamp(this.#startY, ay.max);
      }
      this.#started = image !== undefined;
      this.#slide = null;
      this.#spent = undefined;
    }
  }
  #started = false;
  /** 「調べる」で動かしている間の 1 フレームの速さ */
  #slide: Scroll = null;
  /** 「調べる」で動かす前から続いていた台本のスクロール（もう当てない。新しい scroll 命令で別の値になる） */
  #spent: Scroll | undefined = undefined;

  /** 1 フレーム進める（端でちょうど止める）。scroll は台本のスクロール（エンジンの stage.scroll） */
  tick(scroll: Scroll): void {
    if (!this.#image) return;
    const v = this.#slide ?? (scroll && scroll !== this.#spent ? scroll : null);
    if (!v) return;
    const { ax, ay } = this.#axes();
    const maxX = ax.max,
      maxY = ay.max;
    this.x = Math.max(0, Math.min(maxX, this.x + v.x));
    this.y = Math.max(0, Math.min(maxY, this.y + v.y));
    // 「調べる」の動きは、進む向きの端に着いたら終わる
    if (this.#slide) {
      const endX = v.x === 0 || this.x === (v.x > 0 ? maxX : 0);
      const endY = v.y === 0 || this.y === (v.y > 0 ? maxY : 0);
      if (endX && endY) this.#slide = null;
    }
  }

  /** 今の位置と背景の大きさ（背景が無ければ null） */
  get pos(): BackgroundPos | null {
    if (!this.#image) return null;
    return { x: this.x, y: this.y, ...size(this.#image) };
  }

  /** 画面の左上 (0, 0) に当たる背景の座標（背景が画面より狭ければ負になる） */
  get origin(): [number, number] {
    const { ax, ay } = this.#axes();
    return [this.x - ax.pad, this.y - ay.pad];
  }

  /** 画面の点 → 背景の座標（調べる範囲の座標） */
  toBackground(x: number, y: number): [number, number] {
    const [ox, oy] = this.origin;
    return [x + ox, y + oy];
  }

  /**
   * 調べられる所（画面の座標）。背景の座標で、4:3 の画面の大きさと背景の大きさの大きい方まで。
   * 4:3 では画面全体。広い画面では、狭い背景の左右の黒い所を外す（画面の幅で調べた結果が変わらないように）
   */
  get examinable(): Rect {
    if (this.#L.dx === 0) return { x: 0, y: 0, w: this.#L.w, h: this.#L.h };
    const { w, h } = this.#axes();
    const [ox, oy] = this.origin;
    const x0 = Math.max(0, -ox),
      y0 = Math.max(0, -oy);
    const x1 = Math.min(this.#L.w, Math.max(SCREEN_W, w) - ox),
      y1 = Math.min(this.#L.h, Math.max(SCREEN_H, h) - oy);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  /** 「調べる」で背景を動かしている最中か */
  get sliding(): boolean {
    return this.#slide !== null;
  }

  /** 「調べる」で背景を動かせる向き（動かせなければ null） */
  slideStep(): Scroll {
    const pos = this.pos;
    return pos && !this.#slide ? examineScrollStep(pos, this.#L.w, this.#L.h) : null;
  }

  /**
   * 「調べる」で背景を端から端へ動かし始める（動かせたら true）。
   * scroll は今の台本のスクロール。動かした後は、それに引き戻されないよう当てない
   */
  slide(scroll: Scroll): boolean {
    const step = this.slideStep();
    if (!step) return false;
    this.#slide = step;
    this.#spent = scroll;
    return true;
  }

  /**
   * 人物・重ね絵（4:3 の枠の座標で描くもの）をずらす量。背景をスクロールした分だけ一緒に動き、
   * 広い画面では 4:3 の枠を置いた分も足す
   */
  get offset(): [number, number] {
    const [ox, oy] = this.origin;
    return [this.#startX - ox, this.#startY - oy];
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.#image) return;
    const { w, h, ax, ay } = this.#axes();
    const sw = Math.min(this.#L.w, w),
      sh = Math.min(this.#L.h, h);
    ctx.drawImage(this.#image, this.x, this.y, sw, sh, ax.pad, ay.pad, sw, sh);
  }
}

const clamp = (v: number, max: number) => Math.max(0, Math.min(max, v));

function size(img: CanvasImageSource): { w: number; h: number } {
  const i = img as { width: number; height: number };
  return { w: i.width, h: i.height };
}
