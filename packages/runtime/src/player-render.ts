// Player（player.ts）の、上の画面（DS 版のメイン画面）の描画。

import { SCREEN_H, SCREEN_W, TEXT_COLORS, TOP } from './layout.ts';
import { canOpenRecord, onCross, type PlayerHost } from './player-host.ts';
import { drawScene } from './scene.ts';
import { drawTopButton, lifeTop } from './top-buttons.ts';
import * as W from './widgets.ts';

/** 上の画面を描く（揺れ・フラッシュ・法廷記録は Player が重ねる） */
export function renderScreen(h: PlayerHost) {
  const p = h.p;
  const b = h.beat;
  const blinkOn = (h.frame >> 4) % 2 === 0;
  const arrow = () => {
    if (!h.typing) W.nextArrow(p, h.frame);
  };
  const typed = () => h.tw?.visible ?? [];
  const full = () => h.tw?.full ?? [];

  if (b.kind === 'card') {
    p.rect(0, 0, SCREEN_W, SCREEN_H, '#000000');
    W.textbox(p, null);
    W.centeredGlyphs(p, typed(), full(), TEXT_COLORS.green, W.textTop(p));
    arrow();
    return;
  }

  drawScene(
    h.p,
    h.engine,
    b,
    { typing: h.typing, frame: h.frame, blink: h.blink > 0 },
    h.fx,
    h.views,
  );

  if (b.kind === 'choice') {
    p.dim({ x: 0, y: 0, w: SCREEN_W, h: SCREEN_H }, '#000000', 0.45);
    const last = h.lastLine;
    W.textbox(p, last?.name ?? null, TOP.choiceBox);
    if (last) W.bodyText(p, last.lines, last.color, TOP.choiceBox);
    W.choiceBand(p, h.labels.choicePrompt);
    W.choiceButtons(p, b.options, h.choiceSel, blinkOn);
    return;
  }

  const stage = h.engine.state.stage;
  if (stage.evidence && b.kind !== 'banner' && b.kind !== 'shout')
    W.thumbnail(p, stage.evidence, h.engine.scenario.evidence[stage.evidence], stage.evidenceRight);
  const added = h.added ? h.engine.scenario.evidence[h.added] : undefined;
  if (h.added && added) W.addedWindow(p, h.added, added);
  if (b.kind === 'statement' && !b.cross)
    p.fonts.text.draw(h.labels.testifying, 3, 3, { color: '#48e048', outline: '#0c300c' });
  const gauge = stage.lifeGauge ?? (onCross(h) || b.kind === 'demand');
  if (gauge || h.lifeShow > 0)
    W.lifeMarks(p, h.engine.state.life, h.engine.scenario.maxLife, lifeTop(p));
  if (canOpenRecord(h)) drawTopButton(p, 'record', h.labels);
  if (b.kind === 'statement' && b.cross) {
    drawTopButton(p, 'press', h.labels, b.canPress);
    drawTopButton(p, 'present', h.labels);
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
      const slide = h.reduceMotion ? 1 : Math.min(1, h.timer / 200);
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
      else W.bubble(p, b.shout, h.reduceMotion ? 1 : Math.min(1, h.timer / 120));
      break;
    }
    case 'investigate':
      h.inv.render(p, b, h.labels, h.frame, h.markers, h.views.bg);
      break;
    case 'end':
      W.endScreen(p, h.labels.end);
      break;
    case 'gameover':
      W.endScreen(p, h.labels.gameover);
      break;
  }
}
