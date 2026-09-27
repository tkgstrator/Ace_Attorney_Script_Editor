// 証拠品・人物の「詳細の札」（アイコンの枠 ＋ 名前の帯と説明文の欄）。
// 法廷記録の詳細画面（下画面）と、証拠品を受け取ったときに上画面に出る窓で、同じ描き方を使う（寸法だけ違う）。
import { REC_COLORS as C, UI, type Rect } from './layout.ts';
import type { Painter } from './painter.ts';
import * as Parts from './record-parts.ts';

export interface CardGeometry {
  icon: Rect;
  info: Rect;
  name: Rect;
  desc: Rect;
  descText: { x: number; y: number; lineH: number };
  /** 名前の字の点の範囲の真ん中を置く x */
  nameCx: number;
  /** 説明文の欄の色（省略すると法廷記録の色）と、中央の文字の絵の幅だけ違う色にする範囲（元のゲームの上画面の窓） */
  descColor?: string;
  descInner?: { x: number; w: number; color: string };
}

export interface CardContent {
  tab: 'evidence' | 'profile';
  label: string;
  description: string;
  /** アイコン（64×64）を r に描く */
  drawIcon(r: Rect): void;
}

/** 法廷記録の詳細画面の寸法（DS 版の下画面） */
export const RECORD_CARD: CardGeometry = {
  icon: UI.rec.icon, info: UI.rec.info, name: UI.rec.detailName, desc: UI.rec.detailDesc,
  descText: UI.rec.descText, nameCx: UI.rec.nameCx.detail,
};

/** 証拠品を受け取ったときの窓の寸法（DS 版の上画面。詳細画面より名前と説明の枠が 12 ドット広い） */
export const ADDED_CARD: CardGeometry = {
  icon: { x: 6, y: 22, w: 68, h: 68 },
  info: { x: 89, y: 22, w: 159, h: 68 },
  name: { x: 91, y: 24, w: 156, h: 17 },
  desc: { x: 91, y: 41, w: 156, h: 47 },
  // 元のゲームは 128 ドット幅の名前・説明文の絵を x = 104 から重ねている（その範囲だけ緑が少し明るい）
  descText: { x: 104, y: 44, lineH: 15 },
  nameCx: 167.5,
  descColor: '#94c594',
  descInner: { x: 104, w: 128, color: '#9cc594' },
};

export function drawCard(p: Painter, g: CardGeometry, c: CardContent): void {
  Parts.frame(p, g.icon);
  const icon = { x: g.icon.x + 2, y: g.icon.y + 2, w: 64, h: 64 };
  p.rect(icon.x, icon.y, icon.w, icon.h, C.cellFill);
  c.drawIcon(icon);
  Parts.frame(p, g.info);
  const N = g.name, D = g.desc;
  p.rect(N.x, N.y, N.w, N.h, C.nameBar);
  nameText(p, c.tab, c.label, g.nameCx, N.y, 16);
  p.rect(D.x, D.y, D.w, 1, C.descEdge);
  p.rect(D.x, D.y + 1, 1, D.h - 2, C.descEdge);
  p.rect(D.x + 1, D.y + 1, D.w - 1, D.h - 2, g.descColor ?? C.desc);
  if (g.descInner) p.rect(g.descInner.x, D.y + 1, g.descInner.w, D.h - 2, g.descInner.color);
  p.rect(D.x, D.y + D.h - 1, 1, 1, C.descCorner);
  p.rect(D.x + 1, D.y + D.h - 1, D.w - 1, 1, C.descBottom);
  // 説明文（3 行まで）。字の真下に 1 ドットの影
  const d = p.fonts.desc;
  const T = g.descText;
  d.draw(d.wrap(c.description, D.x + D.w - T.x - 2).slice(0, 3), T.x, T.y - d.font.ink.top, {
    color: C.descText, shadow: C.descEdge, shadowOffset: [0, 1], lineHeight: T.lineH,
  });
}

/**
 * 名前の帯の文字（橙。フォントはタブで変わる）。DS 版と同じく、字の点の範囲の真ん中を cx に置く。
 * top から height の範囲の上下中央
 */
export function nameText(p: Painter, tab: 'evidence' | 'profile', label: string, cx: number, top: number, height: number) {
  const t = (tab === 'profile' ? p.fonts.profileName : undefined) ?? p.fonts.name ?? p.fonts.text;
  const ink = t.inkBounds(label);
  if (!ink) return;
  t.draw(label, Math.round(cx - (ink[0] + ink[1]) / 2), t.centerY(top, height), { color: C.nameText });
}
