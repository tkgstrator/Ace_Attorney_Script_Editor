// メイン画面の部品。テキストウィンドウ・名前欄・証拠品の窓・ライフ・吹き出しなど。
import type { EvidenceDef } from '@gyakusai/core';
import {
  COLORS,
  type Rect,
  SCREEN_H,
  SCREEN_W,
  SHOUTS,
  type ShoutKind,
  TEXTBOX_ALPHA,
  TOP,
  UI,
} from './layout.ts';
import type { Painter } from './painter.ts';
import { ADDED_CARD, drawCard } from './record-card.ts';
import type { Glyph } from './typewriter.ts';

/** テキストウィンドウと名前欄 */
export function textbox(p: Painter, name: string | null, box: Rect = TOP.box) {
  p.dim({ x: box.x + 2, y: box.y + 2, w: box.w - 4, h: box.h - 4 }, '#000008', TEXTBOX_ALPHA);
  p.outline(box, '#848484');
  p.outline({ x: box.x + 1, y: box.y + 1, w: box.w - 2, h: box.h - 2 }, '#3a3a3a');
  if (!name) return;
  const small = p.fonts.small;
  const tag = {
    x: box.x,
    y: box.y - TOP.nameTagH,
    w: small.measure(name) + 8,
    h: TOP.nameTagH + 1,
  };
  p.rect(tag.x, tag.y, tag.w, tag.h, COLORS.nameTagEdge);
  p.rect(tag.x + 1, tag.y + 1, tag.w - 2, tag.h - 1, COLORS.nameTag);
  small.draw(name, tag.x + 4, small.centerY(tag.y + 1, TOP.nameTagH), { color: '#ffffff' });
}

/** テキストウィンドウの 1 行目の文字画像を置く y 座標（フォントの上の余白を差し引く） */
export function textTop(p: Painter, box: Rect = TOP.box): number {
  return box.y + TOP.inkDY - p.fonts.text.font.ink.top;
}

/** テキストウィンドウの本文 */
export function bodyText(p: Painter, rows: Glyph[][], color: string, box: Rect = TOP.box) {
  const y = textTop(p, box);
  rows.forEach((row, i) => {
    glyphRow(p, row, color, TOP.textX, y + i * TOP.lineH);
  });
}

/** 1 行の文字を、文中の [color] で変えた色ごとにまとめて描く（等幅なので、何文字目かで位置が決まる） */
function glyphRow(p: Painter, row: Glyph[], color: string, x: number, y: number) {
  const t = p.fonts.text;
  let start = 0;
  for (let i = 1; i <= row.length; i++) {
    if (i < row.length && row[i]!.color === row[start]!.color) continue;
    const text = row
      .slice(start, i)
      .map((g) => g.ch)
      .join('');
    t.draw(text, x + start * t.em, y, { color: row[start]!.color ?? color });
    start = i;
  }
}

/** 中央寄せの文（日時・場所の表示）。行の位置は、出し終えたときの行の幅で決める */
export function centeredGlyphs(
  p: Painter,
  rows: Glyph[][],
  fullRows: Glyph[][],
  color: string,
  firstLineY: number,
) {
  const t = p.fonts.text;
  rows.forEach((row, i) => {
    const full = (fullRows[i] ?? row).map((g) => g.ch).join('');
    glyphRow(
      p,
      row,
      color,
      Math.round((SCREEN_W - t.measure(full)) / 2),
      firstLineY + i * TOP.lineH,
    );
  });
}

/** テキストウィンドウに中央寄せで出す文（日時・場所の表示や、証言のタイトル） */
export function centeredText(
  p: Painter,
  lines: string[],
  fullLines: string[],
  color: string,
  firstLineY: number,
) {
  const t = p.fonts.text;
  lines.forEach((l, i) => {
    const x = Math.round((SCREEN_W - t.measure(fullLines[i] ?? l)) / 2);
    t.draw(l, x, firstLineY + i * TOP.lineH, { color });
  });
}

/**
 * 文を読み終えたときの ▶（DS 版の画面から写した形: 幅 1・3・5・7・9・7・5・3・1）。
 * 点滅ではなく、x 243〜246 のあいだを左右に往復する。frame は 60fps で数えたフレーム数
 */
export function nextArrow(p: Painter, frame: number) {
  const t = (frame % TOP.arrow.period) / TOP.arrow.period;
  const x = TOP.arrow.x + Math.round(((1 - Math.cos(t * Math.PI * 2)) / 2) * TOP.arrow.swing);
  [1, 3, 5, 7, 9, 7, 5, 3, 1].forEach((w, i) => {
    p.rect(x, TOP.arrow.y + i, w, 1, '#ffffff');
  });
}

/** 選択肢のボタン */
export function choiceButtons(
  p: Painter,
  options: string[],
  selected: number,
  blinkOn: boolean,
  done: boolean[] = [],
) {
  options.forEach((opt, i) => {
    const r = UI.choice(i, options.length);
    // 本文の字間ではボタンに収まらないときは、詰めたフォントで描く
    const t =
      p.fonts.text.measure(opt) <= r.w - 8 ? p.fonts.text : (p.fonts.condensed ?? p.fonts.desc);
    p.rect(r.x, r.y, r.w, r.h, '#f8f8f8');
    p.rect(r.x, r.y + r.h - 2, r.w, 2, '#c8c0b8');
    t.draw(opt, r.x + r.w / 2, t.centerY(r.y, r.h - 2), { color: '#8a3010', align: 'center' });
    if (done[i]) checkMark(p, r.x + r.w - 16, r.y + 7);
    if (i === selected && blinkOn) p.brackets(r);
  });
}

/** 話し終えた話題などに付ける印（✓）。左上が (x, y)、9×8 ドット */
export function checkMark(p: Painter, x: number, y: number) {
  [
    [0, 4],
    [1, 5],
    [2, 6],
    [3, 5],
    [4, 4],
    [5, 3],
    [6, 2],
    [7, 1],
    [8, 0],
  ].forEach(([dx, dy]) => {
    p.rect(x + dx!, y + dy!, 2, 2, '#30a030');
  });
}

/** 話しながら見せる証拠品の小窓（画面左上） */
export function thumbnail(p: Painter, id: string, ev: EvidenceDef | undefined, right = false) {
  const r = right ? { ...TOP.thumb, x: SCREEN_W - TOP.thumb.x - TOP.thumb.w } : TOP.thumb;
  p.outline(r, '#f0f0f0');
  p.dim({ x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 }, '#888890', 0.85);
  p.evidenceIcon(ev?.icon ?? id, ev?.name ?? id, r.x + 2, r.y + 2, 2);
}

/** 証拠品を入手したときの詳細の窓（DS 版と同じく、画面の幅いっぱいの茶色い枠に、法廷記録の詳細と同じ札を出す） */
export function addedWindow(p: Painter, id: string, ev: EvidenceDef) {
  const r = TOP.added;
  p.rect(r.x, r.y, r.w, r.h, '#efefef');
  p.rect(r.x + 1, r.y + 1, r.w - 1, r.h - 1, '#9c9c9c');
  p.rect(r.x + 2, r.y + 2, r.w - 4, r.h - 4, '#634a31');
  p.rect(r.x + 3, r.y + 3, r.w - 5, r.h - 5, '#735229');
  p.rect(r.x + r.w - 2, r.y, 1, r.h - 1, '#efefef');
  p.rect(r.x, r.y + r.h - 2, r.w - 1, 1, '#efefef');
  drawCard(p, ADDED_CARD, {
    tab: 'evidence',
    label: ev.name,
    description: ev.description,
    drawIcon: (ic) => p.evidenceIcon(ev.icon ?? id, ev.name, ic.x, ic.y, 2),
  });
}

/** 証拠品・人物の名前と説明（法廷記録の詳細と、入手したときの窓で共通） */
export function detailText(p: Painter, nameR: Rect, descR: Rect, name: string, desc: string) {
  const { text, desc: d } = p.fonts;
  p.rect(nameR.x, nameR.y, nameR.w, nameR.h, COLORS.nameBar);
  p.outline(nameR, '#c8c8c8');
  text.draw(
    name,
    Math.round(nameR.x + (nameR.w - text.measure(name)) / 2),
    text.centerY(nameR.y, nameR.h),
    { color: COLORS.nameText },
  );
  p.rect(descR.x, descR.y, descR.w, descR.h, COLORS.desc);
  for (let y = descR.y + 1; y < descR.y + descR.h; y += 2)
    p.rect(descR.x, y, descR.w, 1, COLORS.descLine);
  p.outline(descR, '#c8c8c8');
  d.draw(d.wrap(desc, descR.w - 10).slice(0, 3), descR.x + 5, descR.y + 3, {
    color: COLORS.descText,
    lineHeight: 15,
  });
}

/** ライフ（「！」の数）。右上に並べる。y は上端 */
export function lifeMarks(p: Painter, life: number, max: number, y = TOP.lifeY) {
  const n = Math.min(max, 10);
  for (let i = 0; i < Math.min(life, n); i++) exclamation(p, SCREEN_W - (n - i) * 14, y);
}

/** 斜体の「！」。先に縁取り、次に中身を塗る */
function exclamation(p: Painter, x: number, y: number) {
  const body = (color: string, grow: number) => {
    for (let r = 0; r < 11; r++) {
      const sx = x + Math.floor((10 - r) / 4);
      p.rect(
        sx - grow,
        y + r - (r === 0 ? grow : 0),
        4 + grow * 2,
        1 + (r === 0 ? grow : 0),
        color,
      );
    }
    p.rect(x - grow, y + 12 - grow, 4 + grow * 2, 3 + grow * 2, color);
  };
  body(COLORS.lifeEdge, 1);
  body(COLORS.life, 0);
  p.rect(x + 3, y + 1, 1, 4, '#b0c8ff');
}

/** 「証言開始」「無罪」などの大きな文字。slide は 0〜1 で、右から滑り込ませる */
export function bigText(p: Painter, text: string, y: number, slide = 1) {
  const t = p.fonts.text;
  const scale = 2;
  const target = Math.round((SCREEN_W - t.measure(text, scale)) / 2);
  const x = Math.round(SCREEN_W + (target - SCREEN_W) * slide);
  t.draw(text, x, y, { scale, color: '#f05020', outline: '#ffffff', outlineWidth: 1 });
}

/** 「異議あり！」などの吹き出し。grow は 0〜1 の広がり具合 */
export function bubble(p: Painter, kind: ShoutKind, grow: number) {
  const ctx = p.ctx;
  const s = SHOUTS[kind];
  const cx = SCREEN_W / 2,
    cy = 80,
    n = 22;
  ctx.beginPath();
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * Math.PI * 2,
      r = (k % 2 ? 0.7 : 1) * grow;
    const px = cx + Math.cos(a) * 124 * r,
      py = cy + Math.sin(a) * 70 * r;
    if (k) ctx.lineTo(px, py);
    else ctx.moveTo(px, py);
  }
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#181818';
  ctx.stroke();
  ctx.fillStyle = '#fbf7ee';
  ctx.fill();
  if (grow >= 1)
    p.fonts.text.draw(s.label, cx, cy - 14, {
      scale: 2,
      color: s.color,
      outline: '#181818',
      align: 'center',
    });
}

/** フェードの覆い。alpha は 0（見える）〜 1（覆われている） */
export function fadeCover(p: Painter, color: 'black' | 'white', alpha: number) {
  if (alpha <= 0) return;
  p.dim(
    { x: 0, y: 0, w: SCREEN_W, h: SCREEN_H },
    color === 'white' ? '#ffffff' : '#000000',
    Math.min(1, alpha),
  );
}

/** エンディング・ゲームオーバーの画面 */
export function endScreen(p: Painter, label: string) {
  p.dim({ x: 0, y: 0, w: SCREEN_W, h: SCREEN_H }, '#000000', 0.6);
  bigText(p, label, 72);
}
