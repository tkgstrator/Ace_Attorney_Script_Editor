// 元の台本から変換した章のための、DS 版の人物の動き（動きの番号）と背景（背景の番号）。手元用・配布しない。
//   人物: tables/char_anims.json の動きの番号 → data/tail/chars/by_anim/NNN/fNN.png（使うときに読み込む）
//   背景: location「bg<番号>」→ tables/bg_render.json（形を直した画像 png_fixed と、最初の表示位置 start）
import type { Assets } from '@gyakusai/runtime';

interface AnimDef {
  origin: [number, number];
  frames: { frame: number; dur: number }[];
  end: 'loop' | 'hold' | 'delete';
}

const X = '../../../assets/extracted';
const animTable = import.meta.glob('../../../assets/extracted/tables/char_anims.json', { import: 'default' });
const animPngs = import.meta.glob('../../../assets/extracted/data/tail/chars/by_anim/*/f*.png', { query: '?url', import: 'default' });
const bgRender = import.meta.glob('../../../assets/extracted/tables/bg_render.json', { import: 'default' });
const bgPngs = import.meta.glob('../../../assets/extracted/data/tail/{bg,bg_fixed}/*.png', { query: '?url', import: 'default' });

interface BgDef { id: number; png: string; png_fixed?: string; start: [number, number] }

const SCREEN = { w: 256, h: 192, cx: 128, cy: 96 };

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((ok, ng) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => ng(new Error(`画像を読み込めません: ${url}`));
    img.src = url;
  });
}

interface Loaded { def: AnimDef; frames: Map<number, HTMLCanvasElement> }

/** 動きの番号と背景の番号で引ける Assets を、base に重ねて作る */
export async function withOfficialAnims(base: Assets): Promise<Assets> {
  const tableLoader = Object.values(animTable)[0];
  const bgLoader = Object.values(bgRender)[0];
  if (!tableLoader || !bgLoader) return base;
  const table = ((await tableLoader()) as { anims: Record<string, AnimDef> }).anims;

  // 背景の番号 → PNG（縦長・横長の背景は形を直したもの）と最初の表示位置
  const bgFile = new Map<string, string>();
  const bgStart = new Map<string, [number, number]>();
  for (const b of ((await bgLoader()) as { backgrounds: BgDef[] }).backgrounds) {
    bgFile.set(`bg${b.id}`, `${X}/${b.png_fixed ?? b.png}`);
    bgStart.set(`bg${b.id}`, b.start);
  }
  const backgrounds = new Map<string, HTMLImageElement | null>();
  const background = (key: string) => {
    const path = bgFile.get(key);
    if (!path) return undefined;
    if (!backgrounds.has(key)) {
      backgrounds.set(key, null);
      void bgPngs[path]?.().then(url => loadImage(url as string)).then(img => backgrounds.set(key, img));
    }
    return backgrounds.get(key) ?? undefined;
  };

  // 動きの番号 → コマ（画面の大きさのキャンバスに、基準点を (128, 96) に合わせて置いたもの）
  const anims = new Map<string, Loaded | null>();
  const load = (id: string) => {
    const def = table[id];
    if (!def || anims.has(id)) return;
    anims.set(id, null);
    const dir = `${X}/data/tail/chars/by_anim/${id.padStart(3, '0')}/`;
    const frames = new Map<number, HTMLCanvasElement>();
    void Promise.all([...new Set(def.frames.map(f => f.frame))].map(async n => {
      const loader = animPngs[`${dir}f${String(n).padStart(2, '0')}.png`];
      if (!loader) return;
      const img = await loadImage((await loader()) as string);
      const c = document.createElement('canvas');
      c.width = SCREEN.w;
      c.height = SCREEN.h;
      c.getContext('2d')!.drawImage(img, SCREEN.cx - def.origin[0], SCREEN.cy - def.origin[1]);
      frames.set(n, c);
    })).then(() => anims.set(id, { def, frames }));
  };

  // 人物ごとに、今の動きと始めた時刻（動きが変わったら最初のコマから）
  const playing = new Map<string, { anim: string; start: number }>();
  const frameOf = (character: string, anim: string): HTMLCanvasElement | undefined => {
    load(anim);
    const a = anims.get(anim);
    if (!a) return undefined;
    let p = playing.get(character);
    if (!p || p.anim !== anim) { p = { anim, start: performance.now() }; playing.set(character, p); }
    const total = a.def.frames.reduce((s, f) => s + f.dur, 0);
    let t = Math.floor((performance.now() - p.start) / (1000 / 60));
    if (a.def.end === 'loop' && total > 0) t %= total;
    for (const f of a.def.frames) {
      if (t < f.dur) return a.frames.get(f.frame);
      t -= f.dur;
    }
    return a.def.end === 'delete' ? undefined : a.frames.get(a.def.frames.at(-1)?.frame ?? 0);
  };

  return {
    ...base,
    background: key => background(key) ?? base.background?.(key),
    backgroundStart: key => bgStart.get(key) ?? base.backgroundStart?.(key),
    portrait: (id, frame) => (frame.anim !== undefined ? frameOf(id, String(frame.anim)) : base.portrait?.(id, frame)),
  };
}
