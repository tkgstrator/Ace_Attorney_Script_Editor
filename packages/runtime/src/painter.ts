// ドット単位の描画の部品。矩形・枠・タブ・矢印など、画面のどこでも使う小さなものをまとめる。
import { COLORS, type Rect, type Slant } from './layout.ts';
import type { Assets } from './options.ts';
import type { TextRenderer } from './text.ts';

export interface Fonts {
  /** 本文 */
  text: TextRenderer;
  /** 名前欄などの小さい文字 */
  small: TextRenderer;
  /** 証拠品・人物の説明文 */
  desc: TextRenderer;
  /** 法廷記録の名前の帯の文字（証拠品ファイル。なければ本文のフォント） */
  name?: TextRenderer;
  /** 法廷記録の名前の帯の文字（人物ファイル。なければ name） */
  profileName?: TextRenderer;
  /** 法廷記録の見出しとタブの文字（なければ small） */
  title?: TextRenderer;
  /** 長くて収まらない選択肢などの、詰めた文字（なければ desc） */
  condensed?: TextRenderer;
}

export class Painter {
  readonly ctx: CanvasRenderingContext2D;
  readonly fonts: Fonts;
  readonly assets: Assets;

  constructor(ctx: CanvasRenderingContext2D, fonts: Fonts, assets: Assets) {
    this.ctx = ctx;
    this.fonts = fonts;
    this.assets = assets;
  }

  rect(x: number, y: number, w: number, h: number, color: string) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(x, y, w, h);
  }

  /** 画面全体などを半透明で塗る */
  dim(r: Rect, color: string, alpha: number) {
    this.ctx.globalAlpha = alpha;
    this.rect(r.x, r.y, r.w, r.h, color);
    this.ctx.globalAlpha = 1;
  }

  /** 1 ドットの枠線 */
  outline(r: Rect, color: string) {
    this.rect(r.x, r.y, r.w, 1, color);
    this.rect(r.x, r.y + r.h - 1, r.w, 1, color);
    this.rect(r.x, r.y, 1, r.h, color);
    this.rect(r.x + r.w - 1, r.y, 1, r.h, color);
  }

  /** 角を斜めに落とした形。1 行ずつ塗るので、斜めの辺もドットの階段になる。k は斜めの長さ */
  shape(r: Rect, slant: Slant, color: string, k = 12) {
    for (let row = 0; row < r.h; row++) {
      let l = 0,
        rt = 0;
      const lower = Math.max(0, row - (r.h - 1 - k));
      const upper = Math.max(0, k - row);
      if (slant === 'bl' || slant === 'bottom') l = lower;
      if (slant === 'br' || slant === 'bottom') rt = lower;
      if (slant === 'tl') l = upper;
      if (slant === 'tr') rt = upper;
      if (r.w - l - rt > 0) this.rect(r.x + l, r.y + row, r.w - l - rt, 1, color);
    }
  }

  /** 茶色のタブ型のボタン */
  tab(
    r: Rect,
    slant: Slant,
    label: string,
    opts: { small?: boolean; fill?: string; enabled?: boolean; k?: number } = {},
  ) {
    const k = opts.k ?? 12;
    this.ctx.globalAlpha = opts.enabled === false ? 0.5 : 1;
    this.shape(r, slant, COLORS.tabEdge, k);
    this.shape(
      { x: r.x + 1, y: r.y + 1, w: r.w - 2, h: r.h - 2 },
      slant,
      opts.fill ?? COLORS.tabFill,
      k - 1,
    );
    const t = opts.small ? this.fonts.small : this.fonts.text;
    const inset = k / 2;
    const left = slant === 'bl' || slant === 'tl',
      right = slant === 'br' || slant === 'tr';
    const cx = left
      ? r.x + inset + (r.w - inset) / 2
      : right
        ? r.x + (r.w - inset) / 2
        : r.x + r.w / 2;
    t.draw(label, Math.round(cx - t.measure(label) / 2), t.centerY(r.y, r.h), { color: '#ffffff' });
    this.ctx.globalAlpha = 1;
  }

  /** 中心 (cx, cy)、幅 w、高さ h の三角形の矢印（下向きのときは w が高さ、h が幅） */
  triangle(
    cx: number,
    cy: number,
    w: number,
    h: number,
    dir: 'left' | 'right' | 'down',
    color: string,
  ) {
    for (let i = 0; i < h; i++) {
      const len = Math.round(w * (1 - Math.abs(i - (h - 1) / 2) / (h / 2)));
      if (len <= 0) continue;
      if (dir === 'down') {
        this.rect(Math.round(cx - (h - 1) / 2 + i), Math.round(cy - w / 2), 1, len, color);
      } else {
        const x = dir === 'right' ? Math.round(cx - w / 2) : Math.round(cx + w / 2 - len);
        this.rect(x, Math.round(cy - h / 2 + i), len, 1, color);
      }
    }
  }

  /** 選んでいる項目の四隅のカギ */
  brackets(r: Rect, color = '#f8a020') {
    const k = 8;
    const x0 = r.x - 3,
      x1 = r.x + r.w + 1,
      y0 = r.y - 3,
      y1 = r.y + r.h + 1;
    this.rect(x0, y0, k, 2, color);
    this.rect(x0, y0, 2, k, color);
    this.rect(x1 - k + 2, y0, k, 2, color);
    this.rect(x1, y0, 2, k, color);
    this.rect(x0, y1, k, 2, color);
    this.rect(x0, y1 - k + 2, 2, k, color);
    this.rect(x1 - k + 2, y1, k, 2, color);
    this.rect(x1, y1 - k + 2, 2, k, color);
  }

  /** 証拠品のアイコン。scale は 32 ドットを基準にした倍率（一覧は 1.25 = 40、詳細は 2 = 64）。画像がなければ名前の 1 文字目を出す */
  evidenceIcon(id: string, name: string, x: number, y: number, scale: number) {
    const size = Math.round(32 * scale);
    const img = this.assets.evidence?.(id, size);
    if (img) {
      this.ctx.drawImage(img, x, y, size, size);
      return;
    }
    const t = this.fonts.text;
    const s = Math.max(1, Math.floor(scale));
    t.draw([...name][0] ?? '?', x + size / 2, t.centerY(y, size, s), {
      scale: s,
      color: '#303030',
      align: 'center',
    });
  }

  /**
   * 人物の顔。size は 64（詳細）か 40（一覧）。一覧では 64×64 の顔を縮めて描く（DS 版と同じ）。
   * 顔の画像がなければ立ち絵の上の方を切り出す
   */
  face(id: string, name: string, x: number, y: number, size: 64 | 40, icon?: string) {
    const face = this.assets.face?.(icon ?? id);
    if (face) {
      this.ctx.drawImage(face, 0, 0, 64, 64, x, y, size, size);
      return;
    }
    const img = this.assets.portrait?.(id, { talking: false, blink: false }) as
      | HTMLCanvasElement
      | undefined;
    if (img) {
      this.ctx.drawImage(img, Math.round(img.width / 2 - 32), 8, 64, 64, x, y, size, size);
      return;
    }
    const t = this.fonts.text;
    t.draw([...name][0] ?? '?', x + size / 2, t.centerY(y, size), {
      color: '#303030',
      align: 'center',
    });
  }
}
