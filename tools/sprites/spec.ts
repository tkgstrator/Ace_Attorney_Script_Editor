// 立ち絵の仕様（tools/sprites/SPEC.md）のうち、機械で確かめる数値。
// 根拠は DS 版を測った統計 tools/sprites/official-stats.json・official-chars.json（数値のみ）。

export const SPEC = {
  /** 画面（ドット）。1 ドット = 2px で描く */
  screen: { w: 256, h: 192 },
  /** 推奨のキャンバス（画面と同じ大きさ）と、その中の基準点。公式も基準点を画面の (128, 96) に置く */
  canvas: { w: 256, h: 192 },
  origin: { x: 128, y: 96 },
  /** 1 人あたりの色の上限（透明を除く）。公式は 1 人 15 色（中央値。DS の 4bpp パレット 1 枚） */
  maxColors: 15,
  /** 1 人の全コマを合わせた色の上限。公式でも 2 枚目のパレットを使う人物がいる（p90 で 24 色） */
  maxColorsTotal: 30,
  /** 左右（上下）の点の中間の色で、同じ色の隣がない点の割合の上限（アンチエイリアスの疑い）。公式の p90 = 0.10 */
  aaSuspectMax: 0.1,
  /** 輪郭の点のうち、いちばん暗い 3 色が占める割合の下限。公式の p10 = 0.30、中央値 0.64 */
  outlineDarkMin: 0.3,
  /** 人物の上端・下端（画面の y）の目安。公式は上端 8〜42（p10〜p90）、下端は 75% が画面の下端（191） */
  top: { min: 0, max: 60 },
  bottomMin: 150,
  diff: {
    /** 変えてよい範囲の外で色が変わってよい点の数。公式の差分コマは 0 */
    maxOutside: 0,
    /** 変えてよい範囲の中で変わる点が、人物の点に占める割合の上限。公式は 0.8%（中央値）、多くとも 5% */
    maxChangedFrac: 0.05,
    /** 色が同じとみなす RGB の差の合計（0 = 完全に同じ） */
    tolerance: 0,
    /** 変えてよい範囲を自動で推定するときの窓（ドット）。公式の口は 24×13、目は 26×17（中央値） */
    window: { talk: { w: 32, h: 24 }, blink: { w: 40, h: 20 } } as Record<string, Size>,
    /** 推定した範囲の外側に足す余白（ドット） */
    margin: 1,
    /** 全体のずれを探す範囲（ドット） */
    shiftSearch: 3,
  },
} as const;

export interface Size {
  w: number;
  h: number;
}

/** 部分差分のコマの種類（ファイル名の最後の区切り）。talk = 口パク、blink = まばたき */
export const LOCAL_ROLE = /^(talk|blink)\d*$/;

/** ファイル名（拡張子なし）から、そのコマの種類と、比べるベースのコマの名前を返す */
export function roleOf(id: string, name: string): { role: string; base: string } | null {
  if (name === id) return { role: 'base', base: id };
  if (!name.startsWith(`${id}-`)) return null;
  const parts = name.slice(id.length + 1).split('-');
  const last = parts.at(-1)!;
  const m = LOCAL_ROLE.exec(last);
  if (m) return { role: m[1]!, base: [id, ...parts.slice(0, -1)].join('-') };
  // 別のポーズ（特有の動きのコマ）: 差分は見ず、ベースとは色だけそろえる
  return { role: 'pose', base: id };
}
