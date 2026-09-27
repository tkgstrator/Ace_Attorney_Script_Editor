// 画面の揺れとフラッシュ。元のゲームの動きに合わせている（tables/engine.json・ds_fx.json の解析結果）。
//   揺れ: 毎フレーム ±1 / ±3 / ±7 ドット（強さ 0 / 1 / 2）の乱数でずらす
//   白いフラッシュ: 明るさを白へ寄せる。既定の 3 フレームは「真っ白 2 フレーム → 半分 1 フレーム」
import type { FadeColor, FlashColor, Pose } from '@gyakusai/core';
import { SCREEN_H, SCREEN_W } from './layout.ts';
import type { Painter } from './painter.ts';

const SHAKE_AMPLITUDE = [1, 3, 7];

export class ScreenEffects {
  #shake = 0;
  #amp = 1;
  #flash = 0;
  #flashColor: FlashColor = 'white';
  /** 人物をだんだん出す・消す（out のときは消える人物を覚えておく） */
  charFade: { dir: 'in' | 'out'; frames: number; elapsed: number; character: string | null; pose: Pose | null } | null = null;
  /** 動いているフェード（終わったら null。覆ったままかどうかは状態の stage.fade で決まる） */
  #fade: { dir: 'out' | 'in'; color: FadeColor; frames: number; elapsed: number } | null = null;

  readonly reduceMotion: boolean;

  constructor(reduceMotion: boolean) { this.reduceMotion = reduceMotion; }

  shake(frames: number, strength: number): void {
    if (this.reduceMotion) return;
    this.#shake = frames;
    this.#amp = SHAKE_AMPLITUDE[strength] ?? 1;
  }

  flash(color: FlashColor, frames: number): void {
    this.#flash = frames;
    this.#flashColor = color;
  }

  fade(dir: 'out' | 'in', color: FadeColor, frames: number): void {
    this.#fade = frames > 0 ? { dir, color, frames, elapsed: 0 } : null;
  }

  /** 1 フレーム進める */
  tick(): void {
    if (this.#shake > 0) this.#shake--;
    if (this.#flash > 0) this.#flash--;
    if (this.#fade && ++this.#fade.elapsed >= this.#fade.frames) this.#fade = null;
    if (this.charFade && ++this.charFade.elapsed >= this.charFade.frames) this.charFade = null;
  }

  /** フェードの覆い。動いている間は進み具合、終わった後は covered（stage.fade）の色で覆ったまま */
  drawCover(p: Painter, covered: FadeColor | null): void {
    const f = this.#fade;
    const color = f?.color ?? covered;
    if (!color) return;
    const t = f ? f.elapsed / f.frames : 1;
    const alpha = f ? (f.dir === 'out' ? t : 1 - t) : 1;
    if (alpha > 0) p.dim({ x: 0, y: 0, w: SCREEN_W, h: SCREEN_H }, color === 'white' ? '#ffffff' : '#000000', Math.min(1, alpha));
  }

  /** 揺れの分だけ描く位置をずらす（ctx.save() の後に呼ぶ） */
  applyShake(ctx: CanvasRenderingContext2D): void {
    if (this.#shake <= 0) return;
    const a = this.#amp;
    ctx.translate(Math.round((Math.random() * 2 - 1) * a), Math.round((Math.random() * 2 - 1) * a));
  }

  /** フラッシュの覆い。最後の 1 フレームだけ半分の明るさ */
  drawFlash(p: Painter): void {
    if (this.#flash <= 0) return;
    const alpha = this.#flashColor === 'red' ? 0.45 : this.#flash > 1 ? 1 : 0.5;
    p.dim({ x: 0, y: 0, w: SCREEN_W, h: SCREEN_H }, this.#flashColor === 'red' ? '#ff2020' : '#ffffff', alpha);
  }
}
