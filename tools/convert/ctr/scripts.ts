// 3DS 版（逆転裁判6）の台本の番号表（romfs/table/APP_PARAM_ID_SCRIPT_*.prp、XFS）。
// <E031 表 番号>・<E033 表 番号 ラベル> の表は 0〜4 が各話（APP_PARAM_ID_SCRIPT_0N）、11 が人物（_CHR）、12 が場所（_BG）。
// 項目は XFS のオブジェクトで、05 00 <u16 オブジェクトの番号> <u32 大きさ> 01 00 00 00 で始まる
// （番号は 2 から。0・1 は配列の見出し）。項目の中に名前の文字列（sce02_c200_0100 など）が 2 つ（シーン・台本）並ぶ。
// 空の項目もある。
import { readFileSync } from 'node:fs';

/** 番号 → 台本の名前（sce02_c200_0100。空の項目は null） */
export function loadScriptIds(path: string): (string | null)[] {
  const b = readFileSync(path);
  const heads: { at: number; obj: number }[] = [];
  for (let i = 0; i + 12 <= b.length; i++)
    if (
      b[i] === 5 &&
      b[i + 1] === 0 &&
      b.readUInt32LE(i + 8) === 1 &&
      b[i + 7] === 0 &&
      b[i + 6] === 0
    )
      heads.push({ at: i, obj: b.readUInt16LE(i + 2) });
  const text = b.toString('latin1');
  const out: (string | null)[] = [];
  heads.forEach((h, i) => {
    const seg = text.slice(h.at, heads[i + 1]?.at ?? text.length);
    const names = [...seg.matchAll(/sce\d\d_[A-Za-z0-9_]+/g)].map((m) => m[0]);
    out[h.obj - 2] = names[1] ?? names[0] ?? null;
  });
  return out;
}

export const SCRIPT_TABLE: { [table: number]: string } = { 11: 'CHR', 12: 'BG' };
