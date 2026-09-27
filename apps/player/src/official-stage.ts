// 元のゲームの重ね絵（47 anim）と、法廷の視点の流し（26）の絵と表（手元用・配布しない）。
//   重ね絵: tables/anims47.json（画面上の原点 x, y と終わり方）＋ anims47/NNN/anim.tsv（コマと長さ、画像の中の原点）
//   視点の流し: tables/bg_render.json の pan（全景の画像と、種類ごとの 1 フレームずつの表）
import type { Assets, PanFrame } from '@gyakusai/runtime';

const X = '../../../assets/extracted';
const animsTable = import.meta.glob('../../../assets/extracted/tables/anims47.json', { import: 'default' });
const renderTable = import.meta.glob('../../../assets/extracted/tables/bg_render.json', { import: 'default' });
const tsvs = import.meta.glob('../../../assets/extracted/anims47/*/anim.tsv', { query: '?raw', import: 'default' });
const pngs = import.meta.glob('../../../assets/extracted/{anims47/*/*.png,data/tail/bg_fixed/court_pan_*.png}', { query: '?url', import: 'default' });

interface AnimDef { id: number; x: number; y: number; end: 'loop' | 'stop' | 'delete'; image_dir: string }
interface Loaded { frames: { img: HTMLImageElement; dur: number }[]; ox: number; oy: number; x: number; y: number; end: AnimDef['end'] }
interface RawPanFrame { bg_x: number | null; char: 'departing' | 'arriving'; char_x: number; desk: { kind: string; dx: number } | null }

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ng; i.src = url; });
}

export async function withOfficialStage(base: Assets): Promise<Assets> {
  const a = Object.values(animsTable)[0], r = Object.values(renderTable)[0];
  if (!a || !r) return base;
  const defs = new Map(((await a()) as { anims: AnimDef[] }).anims.map(d => [String(d.id), d]));
  const pan = ((await r()) as { pan: { image: { png_full: string }; types: Record<string, { frames: RawPanFrame[] }> } }).pan;

  // 重ね絵（使うときに読み込む）
  const loaded = new Map<string, Loaded | null>();
  const load = (id: string) => {
    const d = defs.get(id);
    if (!d || loaded.has(id)) return;
    loaded.set(id, null);
    const dir = `${X}/${d.image_dir}`;
    void (async () => {
      const tsv = (await tsvs[`${dir}/anim.tsv`]?.()) as string | undefined;
      if (!tsv) return;
      const [, ox, oy] = tsv.match(/\((\d+), (\d+)\)/)!.map(Number) as [number, number, number];
      const rows = tsv.split('\n').slice(2).filter(l => l.includes('\t')).map(l => l.split('\t'));
      const frames = await Promise.all(rows.map(async ([name, dur]) => ({
        img: await loadImage((await pngs[`${dir}/${name}`]!()) as string), dur: Number(dur),
      })));
      loaded.set(id, { frames, ox, oy, x: d.x, y: d.y, end: d.end });
    })();
  };
  const overlay = (id: string, frame: number) => {
    load(id);
    const o = loaded.get(id);
    if (!o || o.frames.length === 0) return undefined;
    const total = o.frames.reduce((s, f) => s + f.dur, 0);
    let t = o.end === 'loop' && total > 0 ? frame % total : frame;
    let img = o.frames.at(-1)!.img;
    if (t >= total && o.end === 'delete') return undefined;
    for (const f of o.frames) { if (t < f.dur) { img = f.img; break; } t -= f.dur; }
    return { image: img, x: o.x - o.ox, y: o.y - o.oy };
  };

  // 視点の流しの全景
  let panorama: HTMLImageElement | null = null;
  void pngs[`${X}/${pan.image.png_full}`]?.().then(u => loadImage(u as string)).then(img => { panorama = img; });
  const panFrames = new Map<number, PanFrame[]>(Object.entries(pan.types).map(([k, v]) => [Number(k), v.frames.map(f => ({
    bgX: f.bg_x, char: f.char, charX: f.char_x, desk: f.desk ? { kind: f.desk.kind, dx: f.desk.dx } : null,
  }))]));

  return {
    ...base,
    overlay: (id, frame) => overlay(id, frame) ?? base.overlay?.(id, frame),
    panorama: () => panorama ?? base.panorama?.(),
    panFrames: type => panFrames.get(type) ?? base.panFrames?.(type),
  };
}
