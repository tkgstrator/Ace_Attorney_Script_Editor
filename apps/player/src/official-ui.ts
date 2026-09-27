// DS 版の下画面の UI 部品（tools/rom/ex_ui.py で取り出した assets/extracted/ui/、手元用・配布しない）。
// 法廷記録の帯・題・ボタンと、メイン画面に重ねる「法廷記録」「ゆさぶる」「つきつける」の絵、法廷記録の後ろの暗い法廷の絵。
// 色は下画面の出力（6 ビット）に合わせた値で書き出してある。
import type { Assets, UiPart } from '@gyakusai/runtime';

const urls = import.meta.glob('../../../assets/extracted/ui/{obj/*.png,court_bg_sepia.png}', { query: '?url', import: 'default', eager: true }) as Record<string, string>;

/** 部品 → obj/ のファイル名の頭（index.json の番号） */
const FILES: Record<Exclude<UiPart, 'recordBackground'>, string> = {
  frameBar: '000_', frameCorner: '001_', titleEnd: '003_', back: '007_', record: '009_', toProfile: '011_',
  present: '018_', presentCross: '019_', press: '020_', toEvidence: '023_',
  titleProfile: '055_', titleEvidence: '056_', titleFile: '065_',
};

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ng; i.src = url; });
}

/**
 * 暗い法廷の絵（court_bg_sepia.png、推定）から、4 行ごとの明るい横じまを抜いたもの。
 * 横じまは runtime が画面全体に重ねるので、ここで抜いておかないと二重になる
 */
async function courtBackground(url: string): Promise<HTMLCanvasElement> {
  const img = await load(url);
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 192;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, 256, 192);
  for (let y = 2; y < 192; y += 4) {
    for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 4;
      for (let k = 0; k < 3; k++) d.data[i + k] = Math.max(0, d.data[i + k]! - 0x1c);
    }
  }
  g.putImageData(d, 0, 0);
  return c;
}

export async function withOfficialUi(base: Assets): Promise<Assets> {
  const find = (head: string) => Object.entries(urls).find(([k]) => k.includes(`/obj/${head}`))?.[1];
  const parts = new Map<UiPart, CanvasImageSource>();
  await Promise.all(Object.entries(FILES).map(async ([part, head]) => {
    const url = find(head);
    if (url) parts.set(part as UiPart, await load(url));
  }));
  const bgUrl = Object.entries(urls).find(([k]) => k.endsWith('/court_bg_sepia.png'))?.[1];
  if (bgUrl) parts.set('recordBackground', await courtBackground(bgUrl));
  if (parts.size === 0) return base;
  return { ...base, ui: part => parts.get(part) ?? base.ui?.(part) };
}
