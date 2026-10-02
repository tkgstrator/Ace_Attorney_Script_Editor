// Player（player.ts）のキーボード・マウス入力を、エンジンの操作に変換する。
import { hit, TIMING, UI } from './layout.ts';
import { panelButtonAt, panelButtons } from './panel.ts';
import { canOpenRecord, onCross, type PlayerHost } from './player-host.ts';
import { topButtonRect } from './top-buttons.ts';

/** 決定（Enter・スペース・クリック）。文字送りの途中なら全部出し、ページが残っていれば次のページへ */
export function confirm(h: PlayerHost) {
  if (h.backlog.open) return;
  h.backlog.capture(h.engine.state.scene, h.beat, h.tw);
  const b = h.beat;
  if (h.typing) {
    h.tw?.finish();
    h.backlog.capture(h.engine.state.scene, h.beat, h.tw);
    return;
  }
  // ページ送り・選択肢の決定の音（元のゲームの SE 0x2f / 0x2b。ID は ui_page / ui_decide）
  if (!h.lastPage) {
    h.audio?.se('ui_page');
    h.tw?.nextPage();
    return;
  }
  switch (b.kind) {
    case 'line':
    case 'statement':
    case 'card':
      h.audio?.se('ui_page');
      h.engine.advance();
      break;
    case 'banner':
      h.engine.advance();
      break;
    case 'demand':
      h.record.show(h.engine, 'evidence');
      break;
    case 'choice':
      if (h.age >= TIMING.choiceGuardMs) {
        h.audio?.se('ui_decide');
        h.engine.choose(h.choiceSel);
      }
      break;
    case 'end':
    case 'gameover':
      if (h.age >= TIMING.endGuardMs) h.onRestart?.();
      break;
    case 'shout':
    case 'investigate':
    case 'pick':
    case 'fade':
    case 'wait':
      break;
  }
}

/** 法廷記録の操作。台詞の途中で詳しく調べ始めたら、戻ったときに続きから見せるため覚える */
function onRecord<T>(h: PlayerHost, fn: () => T): T {
  const [before, page] = [h.beat, h.tw?.page ?? 0];
  const out = fn();
  h.resume.remember(h.engine, before, page);
  return out;
}

function pressStatement(h: PlayerHost) {
  const b = h.beat;
  if (b.kind === 'statement' && b.canPress) h.engine.press();
}

/** キー入力。操作に使ったら true */
export function key(h: PlayerHost, key: string): boolean {
  if (h.backlog.open) return h.backlog.key(key);
  if (key === 'b' || key === 'B') {
    h.backlog.capture(h.engine.state.scene, h.beat, h.tw);
    h.backlog.show();
    return true;
  }
  if (h.record.open) return onRecord(h, () => h.record.key(h.engine, key));
  const b = h.beat;
  if (b.kind === 'investigate')
    return h.inv.key(h.engine, b, key, () => h.record.show(h.engine, 'evidence'), h.views.bg);
  if (b.kind === 'pick') return h.pick.key(h.engine, b, key, h.views.bg);
  if (b.kind === 'choice' && !h.typing) {
    const n = b.options.length;
    if (key === 'ArrowUp') {
      h.choiceSel = (h.choiceSel + n - 1) % n;
      h.audio?.se('ui_select');
      return true;
    }
    if (key === 'ArrowDown') {
      h.choiceSel = (h.choiceSel + 1) % n;
      h.audio?.se('ui_select');
      return true;
    }
  }
  // サイコ・ロックの挑戦中のつきつけは、Esc で「やめる」（B はバックログ）
  if (b.kind === 'demand' && b.giveUp && !h.typing && key === 'Escape') {
    h.engine.giveUp();
    return true;
  }
  if (key === 'Enter' || key === ' ') confirm(h);
  else if ((key === 'x' || key === 'X') && canOpenRecord(h)) h.record.show(h.engine);
  else if (onCross(h) && (key === 'z' || key === 'Z')) pressStatement(h);
  else if (onCross(h) && key === 'ArrowRight') confirm(h);
  else if (onCross(h) && key === 'ArrowLeft') h.engine.back();
  else return false;
  return true;
}

/** クリック（画面の座標） */
export function click(h: PlayerHost, x: number, y: number) {
  const panel = h.p.layout.panel;
  if (panel && x >= panel.x) {
    const btn = panelButtonAt(
      panel,
      panelButtons(h, () => confirm(h)),
      x,
      y,
    );
    // 法廷記録のボタンは、キー・クリックと同じく resume を覚える
    if (btn && h.record.open) onRecord(h, btn.run);
    else btn?.run();
    return;
  }
  if (h.backlog.open) {
    h.backlog.click(x, y);
    return;
  }
  if (h.record.open) {
    onRecord(h, () => h.record.click(h.engine, x, y));
    return;
  }
  const b = h.beat;
  // 4:3 は DS 版の下画面のボタンを画面に重ねているので、その当たりを先に調べる（16:9 は右の欄）
  const overlay = !panel;
  const onRecordButton = overlay && canOpenRecord(h) && hit(topButtonRect(h.p, 'record'), x, y);
  if (b.kind === 'investigate' && !onRecordButton) {
    h.inv.click(h.engine, b, x, y, () => h.record.show(h.engine, 'evidence'), h.views.bg);
    return;
  }
  if (b.kind === 'pick') {
    h.pick.click(h.engine, b, x, y, h.views.bg);
    return;
  }
  if (onRecordButton) {
    h.record.show(h.engine, 'evidence');
    return;
  }
  if (overlay && b.kind === 'demand' && b.giveUp && hit(UI.pressTab, x, y)) {
    h.engine.giveUp();
    return;
  }
  if (overlay && onCross(h)) {
    if (hit(topButtonRect(h.p, 'press'), x, y)) {
      pressStatement(h);
      return;
    }
    if (hit(topButtonRect(h.p, 'present'), x, y)) {
      h.record.show(h.engine, 'evidence');
      return;
    }
  }
  if (b.kind === 'choice') {
    if (h.typing) {
      confirm(h);
      return;
    }
    const i = b.options.findIndex((_, j) => hit(UI.choice(j, b.options.length), x, y));
    if (i >= 0 && h.age >= TIMING.choiceGuardMs) {
      h.audio?.se('ui_decide');
      h.engine.choose(i);
    }
    return;
  }
  confirm(h);
}
