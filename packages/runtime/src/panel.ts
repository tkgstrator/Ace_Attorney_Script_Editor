// 16:9 の画面の右の欄。DS 版で下画面にあったボタン（法廷記録・進む・ゆさぶる・つきつける・前後の証言・探偵メニューなど）を
// 上から 38 ドットごとの 5 段に、DS 版の茶色のボタンと同じ 80×32 で並べる。0 段目はいつも「法廷記録」。
// どのボタンを出すかは今の Beat で決め、描画（drawPanel）と当たりの判定（player-input.ts）に同じ一覧を使う。
import { hit, type Rect } from './layout.ts';
import type { Painter } from './painter.ts';
import { canOpenRecord, type PlayerHost } from './player-host.ts';

export interface PanelButton {
  /** 段（0〜4）。[最初の段, 最後の段] なら、その段まで縦にのばした大きなボタン */
  slot: number | readonly [number, number];
  /** 段の左半分・右半分（◀ ▶ を並べるとき） */
  half?: 'left' | 'right';
  /** 文字（三角だけのボタンは空） */
  label: string;
  arrow?: 'left' | 'right' | 'up' | 'down';
  /** false なら薄く描き、押しても何もしない */
  enabled?: boolean;
  /** キーで選んでいる（点滅するカギを付ける） */
  selected?: boolean;
  run: () => void;
}

const BUTTON_W = 80;
const BUTTON_H = 32;
const STEP = 38;
const TOP_Y = 4;
const HALF_GAP = 4;

const PANEL_BG = '#867971';
const PANEL_STRIPE = '#7b6e67';
const PANEL_EDGE = '#454545';

/** ボタンの矩形（画面の座標） */
export function buttonRect(panel: Rect, b: Pick<PanelButton, 'slot' | 'half'>): Rect {
  const [first, last] = typeof b.slot === 'number' ? [b.slot, b.slot] : b.slot;
  const x = panel.x + Math.floor((panel.w - BUTTON_W) / 2);
  const y = panel.y + TOP_Y + first * STEP;
  const h = (last - first) * STEP + BUTTON_H;
  if (!b.half) return { x, y, w: BUTTON_W, h };
  const w = (BUTTON_W - HALF_GAP) / 2;
  return { x: b.half === 'left' ? x : x + w + HALF_GAP, y, w, h };
}

/** 法廷記録を開いている間のボタン（画面の中には描かない）。0 段目が切り替えのタブ、1 段目が「つきつける」、2 段目が「調べる」、4 段目が「もどる」 */
function recordButtons(h: PlayerHost): PanelButton[] {
  const { record, engine, labels } = h;
  const out: PanelButton[] = [];
  if (record.canSwitch(engine))
    out.push({
      slot: 0,
      label: record.tab === 'evidence' ? labels.profileTab : labels.evidenceTab,
      run: () => record.switchTab(engine),
    });
  if (record.canPresent(engine))
    out.push({ slot: 1, label: labels.present, run: () => record.present(engine) });
  if (record.inspectable(engine))
    out.push({ slot: 2, label: labels.examine, run: () => record.inspect(engine) });
  out.push({ slot: 4, label: labels.back, run: () => record.back() });
  return out;
}

/** 今の場面で欄に出すボタン。confirm は決定（文字送り・次へ）。法廷記録を開いている間は、その記録のボタン */
export function panelButtons(h: PlayerHost, confirm: () => void): PanelButton[] {
  if (h.backlog?.open)
    return [
      { slot: [0, 1], label: '', arrow: 'up', run: () => h.backlog.scroll(-64) },
      { slot: [2, 3], label: '', arrow: 'down', run: () => h.backlog.scroll(64) },
      {
        slot: 4,
        label: h.labels.back,
        run: () => {
          h.backlog.open = false;
        },
      },
    ];
  if (h.record.open) return recordButtons(h);
  const b = h.beat;
  const openRecord = () => h.record.show(h.engine, 'evidence');
  const out: PanelButton[] = [];
  if (canOpenRecord(h)) out.push({ slot: 0, label: h.labels.record, run: openRecord });
  const advance: PanelButton = { slot: [2, 4], label: '', arrow: 'right', run: confirm };
  switch (b.kind) {
    case 'line':
    case 'card':
      out.push(advance);
      break;
    case 'statement':
      if (!b.cross) {
        out.push(advance);
        break;
      }
      out.push(
        { slot: 1, label: h.labels.press, enabled: b.canPress, run: () => h.engine.press() },
        { slot: 2, label: h.labels.present, run: openRecord },
        { slot: [3, 4], half: 'left', label: '', arrow: 'left', run: () => h.engine.back() },
        { slot: [3, 4], half: 'right', label: '', arrow: 'right', run: confirm },
      );
      break;
    case 'demand':
      out.push({ slot: 2, label: h.labels.present, run: openRecord });
      if (b.giveUp) out.push({ slot: 4, label: h.labels.giveUp, run: () => h.engine.giveUp() });
      break;
    case 'investigate':
      out.push(...h.inv.panelButtons(h.engine, b, h.labels, openRecord, h.views.bg));
      break;
    case 'pick':
      out.push(...h.pick.panelButtons(h.engine, b, h.labels));
      break;
    default:
      break;
  }
  const occupied = out.some((button) =>
    typeof button.slot === 'number'
      ? button.slot === 1
      : button.slot[0] <= 1 && button.slot[1] >= 1,
  );
  if (!occupied)
    out.push({
      slot: 1,
      label: h.labels.backlog,
      run: () => {
        h.backlog.capture(h.engine.state.scene, h.beat, h.tw);
        h.backlog.show();
      },
    });
  return out;
}

/** 点 (x, y) のボタン（押せないボタン・ボタンの無い所なら undefined） */
export function panelButtonAt(
  panel: Rect,
  buttons: PanelButton[],
  x: number,
  y: number,
): PanelButton | undefined {
  return buttons.find((b) => b.enabled !== false && hit(buttonRect(panel, b), x, y));
}

/** 欄を描く。frame は選んでいるボタンのカギの点滅に使う */
export function drawPanel(p: Painter, panel: Rect, buttons: PanelButton[], frame: number) {
  p.rect(panel.x, panel.y, panel.w, panel.h, PANEL_BG);
  for (let y = panel.y + 2; y < panel.y + panel.h; y += 3)
    p.rect(panel.x, y, panel.w, 1, PANEL_STRIPE);
  p.rect(panel.x, panel.y, 1, panel.h, PANEL_EDGE);
  const blinkOn = (frame >> 4) % 2 === 0;
  for (const b of buttons) {
    const r = buttonRect(panel, b);
    const enabled = b.enabled !== false;
    p.button(
      r,
      () => {
        p.tab(r, 'none', b.label, { enabled });
        if (b.arrow) arrow(p, r, b.arrow, enabled);
        if (b.selected && blinkOn) p.brackets(r);
      },
      enabled,
      b.label || b.arrow || '',
      b.selected === true,
    );
  }
}

/** ボタンの真ん中の三角。大きさはボタンの小さい方の辺に合わせる */
function arrow(p: Painter, r: Rect, dir: 'left' | 'right' | 'up' | 'down', enabled: boolean) {
  const size = Math.min(r.w, r.h);
  const w = Math.max(8, Math.round(size * 0.36));
  const h = Math.round(w * 1.3);
  const cx = r.x + r.w / 2,
    cy = r.y + r.h / 2;
  p.ctx.globalAlpha = enabled ? 1 : 0.5;
  if (dir === 'left' || dir === 'right') p.triangle(cx, cy, w, h, dir, '#ffffff');
  else {
    // 上向き・下向き: 1 行ずつ、先から根元へ幅を広げる
    for (let i = 0; i < w; i++) {
      const len = Math.max(1, Math.round(((i + 1) / w) * h));
      const y = dir === 'up' ? cy - w / 2 + i : cy + w / 2 - 1 - i;
      p.rect(Math.round(cx - len / 2), Math.round(y), len, 1, '#ffffff');
    }
  }
  p.ctx.globalAlpha = 1;
}
