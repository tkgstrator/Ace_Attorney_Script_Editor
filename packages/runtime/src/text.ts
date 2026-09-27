// canvas への文字描画。座標と大きさはすべてドット単位。
// 画面側（Player）が canvas 全体を拡大して描くので、ここではドット絵と同じ格子に文字を置くだけでよい。

const NO_LINE_START = '。、，．」』）！？ー…‥ぁぃぅぇぉっゃゅょァィゥェォッャュョ';
const CACHE_LIMIT = 2000;

export interface FontSpec {
  /** CSS の font-family */
  family: string;
  /** 1 em のドット数（PixelMplus12 なら 12） */
  size: number;
  /** ベースラインから、ドット格子の上端までの距離（ドット） */
  ascent: number;
  /** 1 行の画像の高さ（ドット） */
  rows: number;
  /** 日本語の文字が実際に塗られる範囲（画像の上端からのドット数。bottom は含まない）。上下中央の計算に使う */
  ink: { top: number; bottom: number };
  /**
   * 1 文字のマスの幅（ドット）。指定すると等幅で並べ、size との差が文字の間の空きになる。
   * 半角の英数字・記号・空白は全角の字形に置き換え、全角の字形がない文字はマスの中央に置く。
   */
  cell?: number;
  /**
   * ドット画像のフォント（全文字を並べた画像）。これがあるときは family のフォントを使わず、画像から点を写す。
   * atlas は loadFonts() などで後から入れる
   */
  bitmap?: { atlas: BitmapAtlas | null };
  /** このフォントにない文字を描く代わりのフォント。インクの上端がそろうように上下の位置を合わせる */
  fallback?: FontSpec;
  /** 文字を横・縦にずらす量（ドット）。元の画面と位置を合わせるときに使う */
  dx?: number;
  dy?: number;
}

/** 全文字を size × size のマスに columns 列で並べた画像と、その文字の並び */
export interface BitmapAtlas {
  size: number;
  columns: number;
  /** 文字 → 何番目のマスか */
  index: Map<string, number>;
  /** 画像の幅と、各画素の明るさ（RGBA の並び） */
  width: number;
  pixels: Uint8ClampedArray;
}

export interface TextStyle {
  /** 文字を何倍で描くか（既定 1）。見出しなどの大きな文字に使う */
  scale?: number;
  color?: string;
  /** 影の色（既定では右下に 1 ドットずらす） */
  shadow?: string;
  /** 影をずらす量（ドット）。既定 [1, 1]。法廷記録の説明文は [0, 1]（真下） */
  shadowOffset?: readonly [number, number];
  outline?: string;
  /** 縁取りの太さ（ドット） */
  outlineWidth?: number;
  /** 行の間隔（ドット） */
  lineHeight?: number;
  align?: 'left' | 'center' | 'right';
}

const snap = (v: number) => Math.round(v);

/**
 * ブラウザは小さな文字を描くと縁をぼかすため、文字は SAMPLE 倍の大きさで描いてから
 * 各ドットのマスの中心の色を拾い、等倍のドット文字にする。
 */
const SAMPLE = 8;

export class TextRenderer {
  readonly ctx: CanvasRenderingContext2D;
  readonly font: FontSpec;
  readonly #big: CanvasRenderingContext2D;
  readonly #cache = new Map<string, HTMLCanvasElement>();

  constructor(ctx: CanvasRenderingContext2D, font: FontSpec) {
    this.ctx = ctx;
    this.font = font;
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = font.rows * SAMPLE;
    this.#big = c.getContext('2d', { willReadFrequently: true })!;
  }

  /** 1 文字ぶんの送り幅（ドット） */
  get em(): number { return this.font.cell ?? this.font.size; }

  /** 文字列の幅（ドット）。等幅のときは、最後の文字の後ろの空きを含めない */
  #dots(text: string): number {
    const { cell, size, family } = this.font;
    if (cell !== undefined) {
      const n = [...text].length;
      return n === 0 ? 0 : n * cell - (cell - size);
    }
    this.#big.font = `${size * SAMPLE}px ${family}`;
    return Math.ceil(this.#big.measureText(text).width / SAMPLE - 0.01);
  }

  /**
   * 文字を上下中央に置くための y 座標。
   * top から height の範囲の中央に、lines 行（行間 lineHeight）のインクが来るようにする。
   */
  centerY(top: number, height: number, scale = 1, lines = 1, lineHeight = 0): number {
    const { ink } = this.font;
    const block = (ink.bottom - ink.top) * scale + (lines - 1) * lineHeight;
    return snap(top + (height - block) / 2 - ink.top * scale);
  }

  measure(text: string, scale = 1): number {
    return this.#dots(text) * scale;
  }

  readonly #inkCache = new Map<string, [number, number] | null>();

  /** 1 行の文字の点がある横の範囲 [左端, 右端]（draw で x に置いたときの、x からのドット数。点が無ければ null） */
  inkBounds(line: string): [number, number] | null {
    const hit = this.#inkCache.get(line);
    if (hit !== undefined) return hit;
    const cols = this.#dots(line) + 1, rows = this.font.rows;
    const atlas = this.font.bitmap?.atlas;
    const mask = atlas ? this.#atlasMask(atlas, line, cols) : this.#sampledMask(line, cols);
    let l = cols, r = -1;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (mask[y * cols + x]) { l = Math.min(l, x); r = Math.max(r, x); }
    const dx = this.font.dx ?? 0;
    const out: [number, number] | null = r < 0 ? null : [l + dx, r + dx];
    if (this.#inkCache.size >= CACHE_LIMIT) this.#inkCache.clear();
    this.#inkCache.set(line, out);
    return out;
  }

  /** maxWidth（ドット）で折り返す。句読点などは行頭に来ないようにする */
  wrap(text: string, maxWidth: number): string[] {
    const limit = maxWidth;
    const out: string[] = [];
    for (const para of text.split('\n')) {
      let line = '';
      for (const ch of para) {
        if (line && this.#dots(line + ch) > limit && !NO_LINE_START.includes(ch)) {
          out.push(line);
          line = ch;
        } else {
          line += ch;
        }
      }
      out.push(line);
    }
    return out;
  }

  draw(text: string | string[], x: number, y: number, style: TextStyle = {}): void {
    const { scale = 1, color = '#ffffff', shadow, shadowOffset = [1, 1], outline, outlineWidth = 1, align = 'left' } = style;
    const lh = style.lineHeight ?? (this.font.size + 4) * scale;
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    const lines = typeof text === 'string' ? [text] : text;
    lines.forEach((line, i) => {
      if (!line) return;
      const img = this.#glyphs(line, color);
      const w = img.width * scale, h = img.height * scale;
      const lx = snap(align === 'center' ? x - w / 2 : align === 'right' ? x - w : x) + (this.font.dx ?? 0) * scale;
      const ly = snap(y + i * lh) + (this.font.dy ?? 0) * scale;
      if (outline) {
        const o = this.#glyphs(line, outline);
        for (let dx = -outlineWidth; dx <= outlineWidth; dx++) {
          for (let dy = -outlineWidth; dy <= outlineWidth; dy++) {
            if (dx || dy) ctx.drawImage(o, lx + dx * scale, ly + dy * scale, w, h);
          }
        }
      }
      if (shadow) ctx.drawImage(this.#glyphs(line, shadow), lx + shadowOffset[0] * scale, ly + shadowOffset[1] * scale, w, h);
      ctx.drawImage(img, lx, ly, w, h);
    });
  }

  /** 1 行ぶんの文字を、指定色・等倍で描いた画像（キャッシュする） */
  #glyphs(line: string, color: string): HTMLCanvasElement {
    const key = `${color}\0${line}`;
    const hit = this.#cache.get(key);
    if (hit) return hit;
    const cols = this.#dots(line) + 1;
    const rows = this.font.rows;
    const atlas = this.font.bitmap?.atlas;
    const mask = atlas ? this.#atlasMask(atlas, line, cols) : this.#sampledMask(line, cols);
    const out = new ImageData(cols, rows);
    const [r, gr, b] = parseColor(color);
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      out.data[i * 4] = r; out.data[i * 4 + 1] = gr; out.data[i * 4 + 2] = b; out.data[i * 4 + 3] = 255;
    }
    const c = document.createElement('canvas');
    c.width = cols;
    c.height = rows;
    c.getContext('2d')!.putImageData(out, 0, 0);
    if (this.#cache.size >= CACHE_LIMIT) this.#cache.clear();
    this.#cache.set(key, c);
    return c;
  }

  /** ドット画像のフォントから、1 行ぶんの点（cols × rows）を写す */
  #atlasMask(atlas: BitmapAtlas, line: string, cols: number): Uint8Array {
    const rows = this.font.rows;
    const step = this.font.cell ?? atlas.size;
    const mask = new Uint8Array(cols * rows);
    [...toFullWidth(line)].forEach((ch, i) => {
      // 全角の字形がなく半角の字形がある（法廷記録の名前の字の「(」や数字など）ときは、半角の字形を使う
      const idx = atlas.index.get(ch) ?? atlas.index.get(toHalfWidth(ch));
      if (idx === undefined) { this.#copyFallback(ch, mask, cols, i * step); return; }
      const ox = (idx % atlas.columns) * atlas.size, oy = Math.floor(idx / atlas.columns) * atlas.size;
      for (let y = 0; y < Math.min(rows, atlas.size); y++) {
        for (let x = 0; x < atlas.size; x++) {
          if (atlas.pixels[((oy + y) * atlas.width + ox + x) * 4]! < 128) continue;
          const dx = i * step + x;
          if (dx < cols) mask[y * cols + dx] = 1;
        }
      }
    });
    return mask;
  }

  #fallbackRenderer: TextRenderer | null = null;

  /** このフォントにない 1 文字を、代わりのフォントで描いて mask の x の位置に重ねる */
  #copyFallback(ch: string, mask: Uint8Array, cols: number, x0: number) {
    const fb = this.font.fallback;
    if (!fb) { warnMissing(ch); return; }
    this.#fallbackRenderer ??= new TextRenderer(this.ctx, fb);
    const fcols = this.#fallbackRenderer.#dots(ch) + 1;
    const fmask = fb.bitmap?.atlas ? this.#fallbackRenderer.#atlasMask(fb.bitmap.atlas, ch, fcols)
      : this.#fallbackRenderer.#sampledMask(ch, fcols);
    const dy = this.font.ink.top - fb.ink.top;
    for (let y = 0; y < fb.rows; y++) {
      const ty = y + dy;
      if (ty < 0 || ty >= this.font.rows) continue;
      for (let x = 0; x < fcols && x0 + x < cols; x++) {
        if (fmask[y * fcols + x]) mask[ty * cols + x0 + x] = 1;
      }
    }
  }

  /** 普通のフォントを大きく描き、各ドットのマスの中心の色を拾う */
  #sampledMask(line: string, cols: number): Uint8Array {
    const { family, size, ascent, rows, cell } = this.font;
    const g = this.#big;
    if (g.canvas.width < cols * SAMPLE) g.canvas.width = cols * SAMPLE;
    g.clearRect(0, 0, g.canvas.width, g.canvas.height);
    g.font = `${size * SAMPLE}px ${family}`;
    g.fontKerning = 'none';
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#fff';
    if (cell === undefined) {
      g.fillText(line, 0, ascent * SAMPLE);
    } else {
      // 1 文字ずつマスに置く
      [...toFullWidth(line)].forEach((ch, i) => {
        const w = g.measureText(ch).width / SAMPLE;
        const x = i * cell + Math.max(0, Math.round((size - w) / 2));
        g.fillText(ch, x * SAMPLE, ascent * SAMPLE);
      });
    }
    const src = g.getImageData(0, 0, cols * SAMPLE, rows * SAMPLE).data;
    const mask = new Uint8Array(cols * rows);
    const half = SAMPLE >> 1;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (src[((y * SAMPLE + half) * cols * SAMPLE + x * SAMPLE + half) * 4 + 3]! >= 128) mask[y * cols + x] = 1;
      }
    }
    return mask;
  }
}

const warned = new Set<string>();
function warnMissing(ch: string) {
  if (warned.has(ch)) return;
  warned.add(ch);
  console.warn(`フォントにない文字です: ${ch}（U+${ch.codePointAt(0)!.toString(16).toUpperCase()}）`);
}

function toHalfWidth(ch: string): string {
  const c = ch.charCodeAt(0);
  return c >= 0xff01 && c <= 0xff5e ? String.fromCharCode(c - 0xfee0) : ch;
}

function toFullWidth(text: string): string {
  return text.replace(/[\x20-\x7e]/g, ch => ch === ' ' ? '\u3000' : String.fromCharCode(ch.charCodeAt(0) + 0xfee0));
}

function parseColor(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`色は #rrggbb で指定してください: ${hex}`);
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

/** 行の配列から、先頭 n 文字だけを取り出す（文字送り用） */
export function revealLines(lines: string[], n: number): string[] {
  const out: string[] = [];
  let left = n;
  for (const l of lines) {
    if (left <= 0) break;
    const chars = [...l];
    out.push(chars.slice(0, left).join(''));
    left -= chars.length;
  }
  return out;
}

/** 直前の文字に応じた文字送りの待ち時間（ミリ秒） */
export function charDelay(prev: string): number {
  if ('。！？'.includes(prev)) return 180;
  if ('、…'.includes(prev)) return 90;
  return 30;
}
