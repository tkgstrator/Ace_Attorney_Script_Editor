// 法廷の視点の流し（元のゲームの 26）。31 フレームのあいだ、1 フレームごとの表（Assets.panFrames）のとおりに
// 法廷の全景（Assets.panorama）を流し、人物と机をずらす。流し終えた後は、背景を変えるまで最後の絵のまま。
import type { Engine } from '@gyakusai/core';
import { SCREEN_H, SCREEN_W } from './layout.ts';
import type { PanFrame } from './options.ts';
import type { Painter } from './painter.ts';

export const PAN_FRAMES = 31;

export class PanView {
  #pan: object | null = null;
  #k = 0;

  /** 1 フレーム進める */
  tick(pan: object | null): void {
    if (pan !== this.#pan) {
      this.#pan = pan;
      this.#k = 0;
    }
    if (pan && this.#k < PAN_FRAMES) this.#k++;
  }

  /** 流している（流し終えた絵を残している）なら描いて true。描けなければ false（ふつうに描く） */
  draw(p: Painter, engine: Engine, typing: boolean, drawBackground: () => void): boolean {
    const { ctx, assets } = p;
    const pan = engine.state.stage.pan;
    const frames = pan ? assets.panFrames?.(pan.type) : undefined;
    const pano = assets.panorama?.();
    if (!pan || !frames || !pano || this.#k === 0) return false;
    const f: PanFrame | undefined = frames[Math.min(this.#k, frames.length) - 1];
    if (!f) return false;
    // 全景の端より外は黒
    if (f.bgX === null) drawBackground();
    else {
      p.rect(0, 0, SCREEN_W, SCREEN_H, '#000000');
      drawSpan(ctx, pano, f.bgX, SCREEN_W, SCREEN_H);
    }
    // 人物: 流す前の人物か、行き先の人物（今の状態）を、原点の x を char_x に合わせて描く
    const who = f.char === 'departing' ? pan.from.character : engine.state.stage.character;
    const pose = f.char === 'departing' ? pan.from.pose : engine.state.stage.pose;
    if (who) {
      const img = assets.portrait?.(who, {
        talking: typing,
        blink: false,
        ...(pose ? { anim: typing ? pose.talk : pose.idle } : {}),
      });
      if (img) {
        const w = (img as { width: number }).width,
          h = (img as { height: number }).height;
        // 動きの指定がある立ち絵は画面の大きさ（原点が中央）、ない立ち絵は下端・中央に合わせる
        if (pose) ctx.drawImage(img, f.charX - SCREEN_W / 2, 0);
        else ctx.drawImage(img, Math.round(f.charX - w / 2), SCREEN_H - h);
      }
    }
    if (f.desk) {
      const desk = assets.foreground?.(f.desk.kind);
      if (desk) ctx.drawImage(desk, f.desk.dx, 0, SCREEN_W, SCREEN_H);
    }
    return true;
  }
}

/** 全景の x から幅 w を、画面の左端から描く（全景の外の所は描かない） */
function drawSpan(
  ctx: CanvasRenderingContext2D,
  pano: CanvasImageSource,
  x: number,
  w: number,
  h: number,
) {
  const pw = (pano as { width: number }).width;
  const x0 = Math.max(0, x),
    x1 = Math.min(pw, x + w);
  if (x1 > x0) ctx.drawImage(pano, x0, 0, x1 - x0, h, x0 - x, 0, x1 - x0, h);
}
