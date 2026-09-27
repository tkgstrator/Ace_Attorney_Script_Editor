// 背景の表示位置とスクロール。画面（256×192）より大きい背景は、表示位置から画面の大きさだけ切り出して描く。
// 元のゲームと同じく、背景を変えると最初の位置（縦長なら下端など）に戻り、スクロールは毎フレーム速さの分だけ動いて端で止まる。
import { SCREEN_H, SCREEN_W } from './layout.ts';

export class BackgroundView {
  #key: string | null = null;
  #image: CanvasImageSource | null = null;
  x = 0;
  y = 0;
  /** 背景を変えたときの位置（人物・重ね絵は、ここからスクロールした分だけ一緒にずれる） */
  #startX = 0;
  #startY = 0;

  /** 今の背景に合わせる。背景が変わったら最初の位置に戻す */
  sync(key: string, image: CanvasImageSource | undefined, start: [number, number] | undefined): void {
    if (key === this.#key && image === this.#image) return;
    const changed = key !== this.#key;
    this.#key = key;
    this.#image = image ?? null;
    if (changed || !this.#started) {
      [this.#startX, this.#startY] = start ?? [0, 0];
      this.x = this.#startX;
      this.y = this.#startY;
      this.#started = image !== undefined;
    }
  }
  #started = false;

  /** 1 フレーム進める（端でちょうど止める） */
  tick(scroll: { x: number; y: number } | null): void {
    if (!scroll || !this.#image) return;
    const { w, h } = size(this.#image);
    this.x = Math.max(0, Math.min(Math.max(0, w - SCREEN_W), this.x + scroll.x));
    this.y = Math.max(0, Math.min(Math.max(0, h - SCREEN_H), this.y + scroll.y));
  }

  /** 人物・重ね絵をずらす量（スクロールした分だけ、背景と一緒に動く） */
  get offset(): [number, number] { return [this.#startX - this.x, this.#startY - this.y]; }

  draw(ctx: CanvasRenderingContext2D): void {
    if (!this.#image) return;
    const { w, h } = size(this.#image);
    const sw = Math.min(SCREEN_W, w), sh = Math.min(SCREEN_H, h);
    ctx.drawImage(this.#image, this.x, this.y, sw, sh, 0, 0, sw, sh);
  }
}

function size(img: CanvasImageSource): { w: number; h: number } {
  const i = img as { width: number; height: number };
  return { w: i.width, h: i.height };
}
