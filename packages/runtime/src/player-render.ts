// Player（player.ts）の、上の画面（DS 版のメイン画面）の描画。16:9 では右の欄（panel.ts）も描く。

import { evidenceDescription } from '@gyakusai/core';
import { lifeGauge, psycheLocks, usesGauge } from './gauge.ts';
import { SCREEN_H, SCREEN_W, TEXT_COLORS, TOP, UI } from './layout.ts';
import { drawPanel, panelButtons } from './panel.ts';
import { canOpenRecord, onCross, type PlayerHost } from './player-host.ts';
import { drawScene } from './scene.ts';
import { drawTopButton, lifeTop } from './top-buttons.ts';
import * as W from './widgets.ts';

/** 1 フレームを描く: 上の画面を揺れの分ずらして描き、フラッシュと法廷記録を重ねる。右の欄は揺らさない */
export function renderFrame(h: PlayerHost) {
  h.p.buttons.beginFrame();
  h.backlog.capture(h.engine.state.scene, h.beat, h.tw);
  const { p, fx, record } = h;
  const { ctx, layout: L } = p;
  ctx.clearRect(0, 0, L.w, L.h);
  ctx.save();
  fx.applyShake(ctx);
  renderScreen(h);
  ctx.restore();
  fx.drawFlash(p);
  // 法廷記録は DS 版の下画面の座標のまま、画面に重ねる
  if (record.open) {
    p.buttons.beginFrame();
    record.render(p, h.engine, h.labels, h.frame);
  }
  if (h.backlog.open) {
    p.buttons.beginFrame();
    h.backlog.render(p, h.labels);
  }
  if (L.panel)
    drawPanel(
      p,
      L.panel,
      panelButtons(h, () => {}),
      h.frame,
    );
}

/** 上の画面を描く（揺れ・フラッシュ・法廷記録は renderFrame が重ねる） */
function renderScreen(h: PlayerHost) {
  const p = h.p;
  const b = h.beat;
  const blinkOn = (h.frame >> 4) % 2 === 0;
  const arrow = () => {
    if (!h.typing) W.nextArrow(p, h.frame);
  };
  const typed = () => h.tw?.visible ?? [];
  const full = () => h.tw?.full ?? [];

  // 4:3 は DS 版の下画面のボタンを画面に重ねる。16:9 は右の欄に出す
  const overlay = !p.layout.panel;
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
    p.dim(p.screen, '#000000', 0.45);
    const last = h.lastLine;
    // 1 画面なので、DS 版のように文字の枠を上にずらして帯を出すことはせず、ふだんの位置に問いかけを残す
    W.textbox(p, last?.name ?? null);
    if (last) W.bodyText(p, last.lines, last.color);
    W.choiceButtons(p, b.options, h.choiceSel, blinkOn);
    return;
  }

  const stage = h.engine.state.stage;
  if (stage.evidence && b.kind !== 'banner' && b.kind !== 'shout')
    W.thumbnail(p, stage.evidence, h.engine.scenario.evidence[stage.evidence], stage.evidenceRight);
  const added = h.added ? h.engine.scenario.evidence[h.added] : undefined;
  if (h.added && added)
    W.addedWindow(
      p,
      h.added,
      added,
      evidenceDescription(h.engine.scenario, h.engine.state, h.added),
    );
  if (b.kind === 'statement' && !b.cross)
    p.fonts.text.draw(h.labels.testifying, 3, 3, { color: '#48e048', outline: '#0c300c' });
  if (stage.locks && !stage.locks.hidden && b.kind !== 'banner' && b.kind !== 'shout')
    psycheLocks(p, stage.locks.left, h.frame);
  const gauge = stage.lifeGauge ?? (onCross(h) || b.kind === 'demand');
  const max = h.engine.scenario.maxLife;
  if ((gauge || h.lifeShow > 0) && usesGauge(max))
    lifeGauge(p, h.engine.state.life, max, stage.lifeRisk, h.frame, lifeTop(p));
  else if (gauge || h.lifeShow > 0) W.lifeMarks(p, h.engine.state.life, max, lifeTop(p));
  if (overlay) {
    // サイコ・ロックの挑戦中のつきつけは「やめる」を出す
    if (b.kind === 'demand' && b.giveUp)
      p.tab(UI.pressTab, 'tl', h.labels.giveUp, { small: true, k: 6 });
    if (canOpenRecord(h)) drawTopButton(p, 'record', h.labels);
    if (b.kind === 'statement' && b.cross) {
      drawTopButton(p, 'press', h.labels, b.canPress);
      drawTopButton(p, 'present', h.labels);
    }
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
      // 吹き出しの絵は画面の大きさ
      if (img) p.ctx.drawImage(img, 0, 0, SCREEN_W, SCREEN_H);
      else W.bubble(p, b.shout, h.reduceMotion ? 1 : Math.min(1, h.timer / 120));
      break;
    }
    case 'investigate':
      h.inv.render(p, b, h.labels, h.frame, h.markers, h.views.bg);
      break;
    case 'pick':
      h.pick.render(p, b, h.labels, h.frame, h.markers, h.views.bg, h.engine.scenario);
      break;
    case 'end':
      W.endScreen(p, h.labels.end);
      break;
    case 'gameover':
      W.endScreen(p, h.labels.gameover);
      break;
  }
}
