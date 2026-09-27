// 法廷記録（証拠品・人物ファイル）の DS 版のアイコンと、記録の後ろの絵（手元用・配布しない）。
// 名前・説明文は、元のゲームでは文字を描き込んだ絵だが、ここではフォントで描く（その絵から作った小さい字のフォント）。
// 絵のキーが「r<記録の番号>」か、変換した証拠品の ID「e<記録の番号>」なら、tables/evidence.json の番号の
// アイコン（record/icon/ja/NNN.png、64×64）を使う。証拠品と人物ファイルは同じ表の番号を使う。
import type { Assets } from '@gyakusai/runtime';

interface RecordItem { id: number; image?: { icon?: { ja?: string } } }

const X = '../../../assets/extracted';
const table = import.meta.glob('../../../assets/extracted/tables/evidence.json', { import: 'default' });
const images = import.meta.glob('../../../assets/extracted/record/icon/ja/*.png', { query: '?url', import: 'default' });
/** 法廷の絵（bg056）。DS 版の法廷記録の下画面の後ろにある絵と同じ構図（色は違う） */
const courtBg = import.meta.glob('../../../assets/extracted/data/tail/bg/bg056_*.png', { query: '?url', import: 'default' });

/**
 * bg056 の色 → DS 版の法廷記録の後ろの色。DS 版の下画面（idle の 14 枚）で、同じ位置の画素の色を平均したもの。
 * DS 版の下画面の絵は、同じ構図で、灰色がかった暗い色になっている
 */
const COURT_TONES: Record<string, [number, number, number]> = {
  '413929': [50, 50, 41], '4a4129': [58, 56, 50], '524a31': [65, 60, 52], '5a4a31': [75, 68, 60], '5a5239': [73, 68, 59],
  '625239': [86, 78, 64], '625241': [77, 69, 60], '6a5a41': [85, 77, 68], '73624a': [101, 93, 80], '7b6a4a': [105, 92, 76],
  '7b6a52': [107, 98, 82], '837352': [118, 110, 96], '83735a': [127, 119, 111],
};

/** 法廷記録の後ろの絵を、bg056 の色を置き換えて作る（bg056 の 3 行ごとの暗い行は、上の行で埋める） */
async function recordBackground(): Promise<HTMLCanvasElement | undefined> {
  const url = await Object.values(courtBg)[0]?.();
  if (!url) return undefined;
  const img = await new Promise<HTMLImageElement>((ok, ng) => { const i = new Image(); i.onload = () => ok(i); i.onerror = ng; i.src = url as string; });
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 192;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  const src = g.getImageData(0, 0, 256, 192);
  const out = g.createImageData(256, 192);
  for (let y = 0; y < 192; y++) {
    const sy = y % 3 === 1 ? y - 1 : y;
    for (let x = 0; x < 256; x++) {
      const i = (sy * 256 + x) * 4;
      const key = [src.data[i], src.data[i + 1], src.data[i + 2]].map(v => v!.toString(16).padStart(2, '0')).join('');
      const tone = COURT_TONES[key] ?? [src.data[i]! * 0.9, src.data[i + 1]! * 0.9, src.data[i + 2]! * 0.95];
      out.data.set([...tone, 255], (y * 256 + x) * 4);
    }
  }
  g.putImageData(out, 0, 0);
  return c;
}

export async function withOfficialRecord(base: Assets): Promise<Assets> {
  const loader = Object.values(table)[0];
  if (!loader) return base;
  const items = ((await loader()) as { items: RecordItem[] }).items;
  const cache = new Map<string, CanvasImageSource | null>();

  /** 絵のキー → アイコン（読み込み中は undefined。次のフレームで出る） */
  const image = (key: string, part: 'icon'): CanvasImageSource | undefined => {
    const m = /^[re](\d+)$/.exec(key);
    const path = m ? items[Number(m[1])]?.image?.[part]?.ja : undefined;
    if (!path) return undefined;
    if (!cache.has(path)) {
      cache.set(path, null);
      const url = images[`${X}/${path}`];
      void url?.().then(u => new Promise<HTMLImageElement>((ok, ng) => {
        const img = new Image();
        img.onload = () => ok(img);
        img.onerror = ng;
        img.src = u as string;
      })).then(img => cache.set(path, img)).catch(() => {});
    }
    return cache.get(path) ?? undefined;
  };

  const bg = await recordBackground().catch(() => undefined);
  return {
    ...base,
    evidence: (id, size) => image(id, 'icon') ?? base.evidence?.(id, size),
    face: id => image(id, 'icon') ?? base.face?.(id),
    ui: part => (part === 'recordBackground' ? bg : undefined) ?? base.ui?.(part),
  };
}
