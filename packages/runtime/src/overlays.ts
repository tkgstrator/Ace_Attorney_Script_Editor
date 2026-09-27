// 重ね絵（元のゲームの 47 anim：血だまり・法廷の全景の人物・木槌など）。出したときからのフレーム数でコマを選ぶ。
import type { Assets } from './options.ts';

export class OverlayView {
  #frame = 0;
  /** 重ね絵の ID → 出したフレーム */
  #since = new Map<string, number>();

  tick(): void { this.#frame++; }

  /** 出している重ね絵を描く（背景と一緒にスクロールした分 ox, oy だけずらす） */
  draw(ctx: CanvasRenderingContext2D, assets: Assets, ids: string[], ox: number, oy: number): void {
    for (const id of [...this.#since.keys()]) if (!ids.includes(id)) this.#since.delete(id);
    for (const id of ids) {
      if (!this.#since.has(id)) this.#since.set(id, this.#frame);
      const o = assets.overlay?.(id, this.#frame - this.#since.get(id)!);
      if (o) ctx.drawImage(o.image, o.x + ox, o.y + oy);
    }
  }
}
