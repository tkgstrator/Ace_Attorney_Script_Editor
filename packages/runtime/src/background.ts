// 背景の表示位置とスクロール。画面より大きい背景は、表示位置から画面の大きさだけ切り出して描く。
// 元のゲームと同じく、背景を変えると最初の位置（縦長なら下端など）に戻り、スクロールは毎フレーム速さの分だけ動いて端で止まる。
// 画面より小さい背景は左上に置く。人物・重ね絵は、背景をスクロールした分だけ offset でずらす。
import { type BackgroundPos, examineScrollStep } from './examine-scroll.ts';
import { SCREEN_H, SCREEN_W } from './layout.ts';

type Scroll = { x: number; y: number } | null;

export class BackgroundView {
  #key: string | null = null;
  #image: CanvasImageSource | null = null;
  /** 画面の左上に見えている背景の座標（画面より狭い向きでは 0） */
  x = 0;
  y = 0;
  /** 背景を変えたときの位置（人物・重ね絵は、ここからスクロールした分だけ一緒にずれる） */
  #startX = 0;
  #startY = 0;

  /** スクロールの端（背景が画面より狭い向きでは 0） */
  #max(): { x: number; y: number } {
    const { w, h } = this.#image ? size(this.#image) : { w: SCREEN_W, h: SCREEN_H };
    return { x: Math.max(0, w - SCREEN_W), y: Math.max(0, h - SCREEN_H) };
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
    const max = this.#max();
    this.x = Math.max(0, Math.min(max.x, this.x + v.x));
    this.y = Math.max(0, Math.min(max.y, this.y + v.y));
    // 「調べる」の動きは、進む向きの端に着いたら終わる
    if (this.#slide) {
      const endX = v.x === 0 || this.x === (v.x > 0 ? max.x : 0);
      const endY = v.y === 0 || this.y === (v.y > 0 ? max.y : 0);
      if (endX && endY) this.#slide = null;
    }
  }

  /** 今の位置と背景の大きさ（背景が無ければ null） */
  get pos(): BackgroundPos | null {
    if (!this.#image) return null;
    return { x: this.x, y: this.y, ...size(this.#image) };
  }

  /** 画面の左上 (0, 0) に当たる背景の座標 */
  get origin(): [number, number] {
    return [this.x, this.y];
  }

  /** 画面の点 → 背景の座標（調べる範囲の座標） */
  toBackground(x: number, y: number): [number, number] {
    return [x + this.x, y + this.y];
  }

  /** 「調べる」で背景を動かしている最中か */
  get sliding(): boolean {
    return this.#slide !== null;
  }

  /** 「調べる」で背景を動かせる向き（動かせなければ null） */
  slideStep(): Scroll {
    const pos = this.pos;
    return pos && !this.#slide ? examineScrollStep(pos) : null;
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

  /** 人物・重ね絵をずらす量。背景をスクロールした分だけ一緒に動く */
  get offset(): [number, number] {
    return [this.#startX - this.x, this.#startY - this.y];
  }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.#image) return;
    const { w, h } = size(this.#image);
    const sw = Math.min(SCREEN_W, w),
      sh = Math.min(SCREEN_H, h);
    ctx.drawImage(this.#image, this.x, this.y, sw, sh, 0, 0, sw, sh);
  }
}

function size(img: CanvasImageSource): { w: number; h: number } {
  const i = img as { width: number; height: number };
  return { w: i.width, h: i.height };
}
