// 仮のドット絵。すべてコードで描いている。本番の画像ができたら、Assets の実装を画像読み込みに差し替える。
// 画面は 256×192 ドットで、ここでもドット単位（等倍）で描く。
import type { Assets } from '@gyakusai/runtime';

const mk = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

const W = 256, H = 192;

function paint(w: number, h: number, fn: (p: Painter) => void): HTMLCanvasElement {
  const c = mk(w, h);
  fn(new Painter(c.getContext('2d')!));
  return c;
}

class Painter {
  readonly g: CanvasRenderingContext2D;
  constructor(g: CanvasRenderingContext2D) { this.g = g; }
  rect(x: number, y: number, w: number, h: number, c: string) { this.g.fillStyle = c; this.g.fillRect(x, y, w, h); }
  ellipse(cx: number, cy: number, rx: number, ry: number, c: string) {
    this.g.fillStyle = c;
    for (let y = -ry; y <= ry; y++) {
      const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))));
      if (w > 0) this.g.fillRect(cx - w, cy + y, w * 2, 1);
    }
  }
  /** 透明でない部分の外側に 1 ドットの輪郭を付ける */
  outline(c: string) {
    const { width: w, height: h } = this.g.canvas;
    const src = this.g.getImageData(0, 0, w, h);
    const out = this.g.createImageData(w, h);
    out.data.set(src.data);
    const [r, g, b] = [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16)) as [number, number, number];
    const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && src.data[(y * w + x) * 4 + 3]! > 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (solid(x, y)) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) {
        const i = (y * w + x) * 4;
        out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = b; out.data[i + 3] = 255;
      }
    }
    this.g.putImageData(out, 0, 0);
  }
}

// ---- 人物 ----

interface Look {
  hair: 'spiky' | 'swept' | 'short' | 'bald';
  hairC: string; hairL: string; skin: string; skinD: string;
  suit: string; suitD: string; shirt: string; tie: string | null;
  mustache?: boolean; beard?: boolean; glasses?: boolean;
}

const LOOKS: Record<string, Look> = {
  naruse: { hair: 'spiky', hairC: '#2a2d4d', hairL: '#4b5185', skin: '#f2c9a4', skinD: '#d59f7c', suit: '#2e5d8c', suitD: '#1f4166', shirt: '#f4f1ea', tie: '#c6414a' },
  himuro: { hair: 'swept', hairC: '#b9c3d6', hairL: '#e4ebf7', skin: '#eec7a6', skinD: '#c99c7c', suit: '#6b2c3e', suitD: '#4a1d2a', shirt: '#f4f1ea', tie: null, glasses: true },
  torii: { hair: 'short', hairC: '#7d828c', hairL: '#a6abb4', skin: '#e9bd96', skinD: '#c8966f', suit: '#7a5b3c', suitD: '#58402a', shirt: '#e9e4d4', tie: '#3f7d4f', mustache: true },
  judge: { hair: 'bald', hairC: '#e8e4dc', hairL: '#ffffff', skin: '#efc6a0', skinD: '#cf9d78', suit: '#23202a', suitD: '#141218', shirt: '#f4f1ea', tie: null, beard: true },
};

function bust(o: Look, blink: boolean, talking: boolean) {
  return paint(128, 150, p => {
    const cx = 64;
    // 胴体
    for (let y = 100; y < 150; y++) {
      const hw = Math.round(26 + Math.min(1, (y - 100) / 22) * 34);
      p.rect(cx - hw, y, hw * 2, 1, o.suit);
      p.rect(cx + hw - 7, y, 7, 1, o.suitD);
    }
    p.rect(cx - 10, 82, 20, 22, o.skinD);
    for (let y = 98; y < 136; y++) {
      const hw = Math.max(0, Math.round(13 - (y - 98) * 0.35));
      p.rect(cx - hw, y, hw * 2, 1, o.shirt);
    }
    if (o.tie) { p.rect(cx - 3, 100, 6, 5, o.tie); for (let y = 105; y < 130; y++) p.rect(cx - 2, y, 4 + (y < 124 ? 0 : -1), 1, o.tie); }
    if (!o.tie && o.hair === 'swept') { p.ellipse(cx, 104, 9, 6, '#f4f1ea'); p.ellipse(cx, 110, 7, 5, '#e6e1d5'); }
    // 顔
    p.ellipse(cx, 56, 23, 29, o.skin);
    p.rect(cx + 17, 40, 5, 30, o.skinD);
    p.rect(cx - 25, 54, 4, 10, o.skin);
    p.rect(cx + 21, 54, 4, 10, o.skinD);
    // 髪
    if (o.hair === 'spiky') {
      p.ellipse(cx, 36, 27, 15, o.hairC);
      for (let i = 0; i < 6; i++) p.rect(cx - 30 + i * 11, 14 + (i % 2) * 5, 9, 14, o.hairC);
      for (let i = 0; i < 3; i++) p.rect(cx + 20 + i * 4, 20 + i * 6, 12, 6, o.hairC);
      p.rect(cx - 25, 36, 6, 16, o.hairC);
      p.rect(cx - 12, 22, 14, 2, o.hairL);
    } else if (o.hair === 'swept') {
      p.ellipse(cx, 34, 26, 12, o.hairC);
      p.rect(cx - 26, 34, 8, 26, o.hairC);
      p.rect(cx + 18, 34, 8, 18, o.hairC);
      for (let i = 0; i < 5; i++) p.rect(cx - 20 + i * 8, 40 + i, 8, 4, o.hairC);
      p.rect(cx - 14, 26, 18, 2, o.hairL);
    } else if (o.hair === 'short') {
      p.ellipse(cx, 34, 24, 10, o.hairC);
      p.rect(cx - 24, 30, 48, 8, o.hairC);
      p.rect(cx - 26, 38, 5, 18, o.hairC);
      p.rect(cx + 21, 38, 5, 18, o.hairC);
      p.rect(cx - 12, 26, 14, 2, o.hairL);
    } else {
      p.ellipse(cx - 23, 52, 5, 10, o.hairC);
      p.ellipse(cx + 23, 52, 5, 10, o.hairC);
      p.rect(cx - 10, 30, 12, 2, '#fff3e4');
    }
    // 目・眉
    const brow = o.hair === 'bald' ? o.hairC : o.hairC;
    p.rect(cx - 16, 50, 11, o.hair === 'bald' ? 3 : 2, brow);
    p.rect(cx + 5, 50, 11, o.hair === 'bald' ? 3 : 2, brow);
    if (!blink) {
      p.rect(cx - 14, 56, 6, 7, '#1d1a2a'); p.rect(cx + 8, 56, 6, 7, '#1d1a2a');
      p.rect(cx - 13, 57, 2, 2, '#fff'); p.rect(cx + 9, 57, 2, 2, '#fff');
    } else {
      p.rect(cx - 15, 60, 8, 2, '#1d1a2a'); p.rect(cx + 7, 60, 8, 2, '#1d1a2a');
    }
    if (o.glasses) {
      for (const gx of [cx - 18, cx + 4]) {
        p.rect(gx, 53, 14, 1, '#d9dde6'); p.rect(gx, 64, 14, 1, '#d9dde6');
        p.rect(gx, 53, 1, 12, '#d9dde6'); p.rect(gx + 13, 53, 1, 12, '#d9dde6');
      }
      p.rect(cx - 4, 57, 8, 1, '#d9dde6');
    }
    p.rect(cx - 1, 66, 3, 5, o.skinD);
    if (o.beard) { p.ellipse(cx, 88, 17, 9, o.hairC); p.rect(cx - 14, 80, 28, 5, o.hairC); }
    if (talking) { p.rect(cx - 5, 75, 10, 4, '#6b2130'); p.rect(cx - 4, 78, 8, 1, '#c85a6a'); }
    else p.rect(cx - 5, 76, 10, 1, '#8a3a44');
    if (o.mustache) p.rect(cx - 10, 72, 20, 3, o.hairC);
    p.outline('#15111c');
  });
}

// ---- 背景（256×192） ----

/** 木の壁（弁護側・検察側で色だけ変える） */
const panels = (base: string, panel: string, light: string, dark: string) => (p: Painter) => {
  p.rect(0, 0, W, H, base);
  p.rect(0, 6, W, 5, light);
  for (let x = 0; x < W; x += 32) {
    p.rect(x + 3, 18, 26, 104, panel); p.rect(x + 3, 18, 26, 2, light); p.rect(x + 27, 18, 2, 104, dark);
  }
  p.rect(0, 124, W, 68, dark);
};

const BACKGROUNDS: Record<string, (p: Painter) => void> = {
  defense: panels('#3b2620', '#56382a', '#7a5238', '#24160f'),
  prosecution: panels('#2a2430', '#3a3244', '#5a4a68', '#17131c'),
  witness: p => {
    p.rect(0, 0, W, H, '#2c3748');
    for (let row = 0; row < 11; row++) {
      const y = row * 12, off = (row % 2) * 12;
      for (let x = -24; x < W; x += 24) { p.rect(x + off, y, 23, 11, '#34415a'); p.rect(x + off, y, 23, 1, '#3f4d69'); }
    }
    p.rect(0, 130, W, 62, '#1e2533');
  },
  judge: p => {
    p.rect(0, 0, W, H, '#43222a');
    for (let x = 0; x < W; x += 16) { p.rect(x, 0, 8, 136, '#4f2830'); p.rect(x + 7, 0, 1, 136, '#361a20'); }
    const cx = W / 2;
    p.ellipse(cx, 40, 34, 34, '#8a6a2c'); p.ellipse(cx, 40, 30, 30, '#c9a24a'); p.ellipse(cx, 40, 22, 22, '#8a6a2c');
    p.rect(cx - 2, 18, 4, 44, '#c9a24a'); p.rect(cx - 22, 38, 44, 4, '#c9a24a');
  },
  court: p => {
    p.rect(0, 0, W, H, '#2b2029');
    p.rect(0, 136, W, 56, '#3a2a22');
  },
};

/** 人物の手前の机（上端の y を揃えている） */
const DESK_Y = 146;
const FOREGROUNDS: Record<string, (p: Painter) => void> = {
  defense: p => { p.rect(0, DESK_Y, W, H - DESK_Y, '#6b3f24'); p.rect(0, DESK_Y, W, 3, '#b07a48'); p.rect(0, DESK_Y + 3, W, 1, '#3a2214'); },
  prosecution: p => { p.rect(0, DESK_Y, W, H - DESK_Y, '#4a3048'); p.rect(0, DESK_Y, W, 3, '#8a6a88'); p.rect(0, DESK_Y + 3, W, 1, '#2a1a28'); },
  witness: p => {
    for (let y = DESK_Y; y < H; y++) { const hw = 70 + Math.min(8, y - DESK_Y); p.rect(W / 2 - hw, y, hw * 2, 1, y < DESK_Y + 3 ? '#b07a48' : '#6b3f24'); }
  },
  judge: p => {
    p.rect(0, DESK_Y + 4, W, H - DESK_Y - 4, '#5a3420'); p.rect(0, DESK_Y + 4, W, 3, '#9a6a3c');
    p.rect(W / 2 - 32, DESK_Y + 12, 64, 16, '#4a2a18'); p.rect(W / 2 - 30, DESK_Y + 14, 60, 12, '#6b3f24');
  },
};

// ---- 証拠品（32×32） ----

const EVIDENCE: Record<string, (p: Painter) => void> = {
  badge: p => {
    p.ellipse(16, 16, 12, 12, '#a47f2a'); p.ellipse(16, 16, 10, 10, '#e2bb52'); p.ellipse(16, 16, 6, 6, '#f5d98a');
    p.rect(15, 8, 2, 15, '#a47f2a'); p.rect(10, 11, 12, 2, '#a47f2a'); p.rect(9, 13, 4, 3, '#a47f2a'); p.rect(19, 13, 4, 3, '#a47f2a');
  },
  autopsy: p => {
    p.rect(7, 3, 18, 27, '#efe9d9'); p.rect(20, 3, 5, 5, '#c9c1ab');
    for (let i = 0; i < 4; i++) p.rect(10, 10 + i * 3, 12, 1, '#8a8475');
    p.ellipse(19, 24, 3, 3, '#c0463c');
  },
  photo: p => {
    p.rect(3, 7, 26, 20, '#f3f0e6'); p.rect(5, 9, 22, 14, '#79a8cf'); p.rect(5, 18, 22, 5, '#4f7a4a');
    p.rect(17, 10, 4, 9, '#6a5a4a'); p.rect(18, 9, 2, 1, '#6a5a4a'); p.rect(18, 12, 2, 2, '#f3f0e6');
  },
  repair: p => {
    p.rect(6, 3, 20, 27, '#8a6038'); p.rect(8, 6, 16, 21, '#f1ecdf'); p.rect(12, 2, 8, 3, '#b8bcc4');
    for (let i = 0; i < 4; i++) p.rect(10, 9 + i * 3, 11, 1, '#8a8475');
    p.rect(13, 21, 12, 2, '#9aa0aa'); p.rect(23, 19, 3, 6, '#9aa0aa');
  },
  clock: p => {
    p.rect(7, 4, 18, 24, '#7a4a2a'); p.rect(7, 4, 18, 2, '#9a6a3c');
    p.ellipse(16, 15, 7, 7, '#f2ead8');
    p.rect(16, 9, 1, 6, '#222222'); p.rect(16, 15, 4, 1, '#222222');
    p.rect(7, 28, 3, 3, '#5a3420'); p.rect(22, 28, 3, 3, '#5a3420');
  },
  keys: p => {
    for (let y = -7; y <= 7; y++) for (let x = -7; x <= 7; x++) {
      const d = Math.hypot(x, y);
      if (d <= 7 && d >= 5) p.rect(11 + x, 11 + y, 1, 1, '#8a8f98');
    }
    p.rect(14, 15, 3, 14, '#e0b650'); p.rect(17, 23, 3, 2, '#e0b650'); p.rect(17, 26, 2, 2, '#e0b650');
    p.rect(8, 16, 3, 12, '#b9bec6'); p.rect(5, 24, 3, 2, '#b9bec6');
    p.rect(19, 13, 3, 11, '#b9bec6'); p.rect(22, 20, 3, 2, '#b9bec6');
  },
};

// ---- 組み立て ----

export function createPlaceholderAssets(): Assets {
  const portraits = new Map<string, HTMLCanvasElement>();
  const bgs = new Map<string, HTMLCanvasElement | undefined>();
  const fgs = new Map<string, HTMLCanvasElement | undefined>();
  const icons = new Map<string, HTMLCanvasElement | undefined>();
  const cached = <T>(m: Map<string, T>, key: string, make: () => T) => {
    if (!m.has(key)) m.set(key, make());
    return m.get(key)!;
  };
  return {
    background: key => cached(bgs, key, () => BACKGROUNDS[key] && paint(W, H, BACKGROUNDS[key])),
    foreground: key => cached(fgs, key, () => FOREGROUNDS[key] && paint(W, H, FOREGROUNDS[key])),
    portrait: (id, f) => {
      const look = LOOKS[id];
      if (!look) return undefined;
      return cached(portraits, `${id}:${+f.blink}:${+f.talking}`, () => bust(look, f.blink, f.talking));
    },
    evidence: id => cached(icons, id, () => EVIDENCE[id] && paint(32, 32, p => { EVIDENCE[id]!(p); p.outline('#15111c'); })),
  };
}
