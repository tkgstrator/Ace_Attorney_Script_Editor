// 生成したドット絵（src/art/ 以下）を読み込み、Assets として返す。
// 画像がまだ無いものは、代わりの Assets（コードで描いた仮の絵）を使う。
//   src/art/character/<人物ID>.png, <人物ID>-talk.png（口パク）
//   src/art/background/<立ち位置>.png, src/art/foreground/<立ち位置>.png
//   src/art/evidence/<証拠品ID>-64.png, <証拠品ID>-32.png
import type { Assets } from '@gyakusai/runtime';

const urls = import.meta.glob('./art/**/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((ok, ng) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => ng(new Error(`画像を読み込めません: ${url}`));
    img.src = url;
  });
}

export async function loadImageAssets(fallback: Assets): Promise<Assets> {
  const images = new Map<string, HTMLImageElement>();
  await Promise.all(Object.entries(urls).map(async ([path, url]) => {
    // './art/evidence/clock-64.png' → 'evidence/clock-64'
    images.set(path.replace(/^\.\/art\//, '').replace(/\.png$/, ''), await load(url));
  }));
  const get = (key: string) => images.get(key);
  return {
    background: key => get(`background/${key}`) ?? fallback.background?.(key),
    foreground: key => get(`foreground/${key}`) ?? fallback.foreground?.(key),
    portrait: (id, frame) => (frame.talking ? get(`character/${id}-talk`) : undefined)
      ?? get(`character/${id}`) ?? fallback.portrait?.(id, frame),
    evidence: (id, size) => get(`evidence/${id}-${size <= 32 ? 32 : 64}`) ?? fallback.evidence?.(id, size),
    face: id => fallback.face?.(id),
  };
}
