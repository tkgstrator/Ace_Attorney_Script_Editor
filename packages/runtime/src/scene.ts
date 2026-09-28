// 背景 → 立ち絵 → 手前（机）→ フェードの覆い、の順に描く。
import type { Beat, Engine, Pose } from '@gyakusai/core';
import type { BackgroundView } from './background.ts';
import type { OverlayView } from './overlays.ts';
import type { PanView } from './pan.ts';
import type { ScreenEffects } from './effects.ts';
import { SCREEN_H, SCREEN_W } from './layout.ts';
import type { Painter } from './painter.ts';

export interface SceneTiming {
  typing: boolean;
  frame: number;
  blink: boolean;
}

export interface SceneViews {
  bg: BackgroundView;
  overlays: OverlayView;
  pan: PanView;
}

export function drawScene(
  p: Painter,
  engine: Engine,
  b: Beat,
  t: SceneTiming,
  fx: ScreenEffects,
  views: SceneViews,
): void {
  const { ctx, assets } = p;
  const { character: who, location, pose, fade, overlays } = engine.state.stage;
  const view = views.bg;
  const key = location ?? (who ? engine.scenario.characters[who]?.stand : undefined) ?? 'court';
  const bg = key === 'black' ? undefined : assets.background?.(key);
  // 背景が無ければ黒（元のゲームの「背景なし」と同じ）。画面より大きい背景（横に流す背景など）は縮めずに左上から描く
  p.rect(0, 0, SCREEN_W, SCREEN_H, '#000000');
  view.sync(key, bg, assets.backgroundStart?.(key));
  // 視点の流しの最中（と、流し終えた後）は、全景・人物・机をその表のとおりに描く
  if (views.pan.draw(p, engine, t.typing, () => view.draw(ctx))) {
    views.overlays.draw(ctx, assets, overlays, 0, 0);
    fx.drawCover(p, fade);
    return;
  }
  view.draw(ctx);
  // 人物は、背景をスクロールした分だけ一緒にずらす
  const [ox, oy] = view.offset;
  ctx.save();
  ctx.translate(ox, oy);
  // 人物の半透明のフェード: 出すときはだんだん濃く、消すときは消える人物をだんだん薄く描く
  const cf = fx.charFade;
  if (cf?.dir === 'out' && cf.character) {
    ctx.globalAlpha = 1 - cf.elapsed / cf.frames;
    drawPortrait(p, cf.character, cf.pose, b, t);
  }
  ctx.globalAlpha = cf?.dir === 'in' ? cf.elapsed / cf.frames : 1;
  if (who) drawPortrait(p, who, pose, b, t);
  ctx.globalAlpha = 1;
  ctx.restore();
  const fg = assets.foreground?.(key);
  if (fg) ctx.drawImage(fg, 0, 0, SCREEN_W, SCREEN_H);
  // 重ね絵は机の手前・文字の枠の奥（背景と一緒にスクロールする）
  views.overlays.draw(ctx, assets, overlays, ox, oy);
  if (engine.state.stage.palette === 'grayscale') grayscale(ctx);
  // フェード: 動いている間は進み具合に合わせ、フェードアウトの後は覆ったまま（台詞はこの上に出る）
  fx.drawCover(p, fade);
}

/** 人物の立ち絵（動きの指定があれば画面の大きさの絵、なければ下端・中央に合わせた絵） */
function drawPortrait(p: Painter, who: string, pose: Pose | null, b: Beat, t: SceneTiming) {
  const { ctx, assets } = p;
  if (pose) {
    // 動きの指定があるときは元のゲームと同じく、話し手によらず文字送りの間は talk、止まっている間は idle
    const img = assets.portrait?.(who, {
      talking: t.typing,
      blink: false,
      anim: t.typing ? pose.talk : pose.idle,
    });
    if (img) ctx.drawImage(img, 0, 0);
    return;
  }
  const speaking =
    (b.kind === 'line' && b.speaker === who && b.color !== 'blue') ||
    (b.kind === 'statement' && b.witness === who);
  const talking = speaking && t.typing && (t.frame >> 3) % 2 === 0;
  const img = assets.portrait?.(who, { talking, blink: t.blink }) as HTMLCanvasElement | undefined;
  if (img) ctx.drawImage(img, Math.round((SCREEN_W - img.width) / 2), SCREEN_H - img.height);
}

/** ここまでに描いた画面を白黒にする（白黒の回想。文字の枠より奥だけ） */
function grayscale(ctx: CanvasRenderingContext2D) {
  const { width, height } = ctx.canvas;
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = Math.round(d[i]! * 0.299 + d[i + 1]! * 0.587 + d[i + 2]! * 0.114);
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
}
