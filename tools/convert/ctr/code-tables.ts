// 3DS 版（逆転裁判6）のゲーム本体（exefs/code.bin、BLZ 圧縮）にある法廷記録の表。
// 台本の証拠品・人物ファイルの番号（<E751 種類 番号>・<E244>・<E225> など）は、この表の番号。
//   証拠品: 40 バイトの項目（絵 2 つ、…、名前の GMD へのポインター、名前の番号、説明文の GMD へのポインター、説明文の番号）。
//           番号 n は n - 1 番目の項目（1 始まり）
//   人物:   32 バイトの項目（名前の GMD、名前の番号、説明文の GMD、説明文の番号、絵 2 つ、年齢の GMD、年齢の番号）。
//           番号 n は n - 1 番目の項目（1 始まり）
// 表の場所は、GMD の名前（msg\evidence_name_00_jpn）を指すポインターが一定の間隔で並ぶ所から探す。
// .code は 0x100000 に置かれる（3DS の決まり）。
import { readFileSync } from 'node:fs';

const BASE = 0x100000;

/** 3DS の .code の BLZ（後ろから読む LZ）を展開する */
export function blz(src: Uint8Array): Uint8Array {
  const v = new DataView(src.buffer, src.byteOffset, src.byteLength);
  const encAndHdr = v.getUint32(src.length - 8, true);
  const inc = v.getUint32(src.length - 4, true);
  const hdr = src[src.length - 5]!;
  const encLen = encAndHdr & 0xffffff;
  const out = new Uint8Array(src.length + inc);
  out.set(src);
  let s = src.length - hdr;
  let d = out.length;
  const end = src.length - encLen;
  while (s > end) {
    let flags = out[--s]!;
    for (let i = 0; i < 8 && s > end; i++, flags <<= 1) {
      if (flags & 0x80) {
        s -= 2;
        const w = out[s]! | (out[s + 1]! << 8);
        const n = ((w >> 12) & 0xf) + 3;
        const disp = (w & 0xfff) + 3;
        for (let k = 0; k < n; k++, d--) out[d - 1] = out[d - 1 + disp]!;
      } else out[--d] = out[--s]!;
    }
  }
  return out;
}

/** ptr を指す u32 が stride ごとに並ぶ、いちばん長い並びの位置 */
function longestRun(words: Uint32Array, ptr: number, stride: number): number[] {
  const hits: number[] = [];
  for (let i = 0; i < words.length; i++) if (words[i] === ptr) hits.push(i);
  let best: number[] = [];
  let cur: number[] = [];
  for (const h of hits) {
    cur = cur.length && h - cur.at(-1)! === stride / 4 ? [...cur, h] : [h];
    if (cur.length > best.length) best = cur;
  }
  return best;
}

export type CodeTables = {
  /** 証拠品の番号 → (名前の番号, 説明文の番号)（名前・説明文は GMD の中の位置） */
  evidence: ({ name: number; caption: number } | null)[];
  /** 人物の番号 → (名前の番号, 説明文の番号, 年齢の番号) */
  profiles: ({ name: number; caption: number; age: number } | null)[];
};

export function loadCodeTables(codeBin: string): CodeTables {
  const code = blz(new Uint8Array(readFileSync(codeBin)));
  const words = new Uint32Array(code.buffer, code.byteOffset, code.byteLength >> 2);
  const va = (s: string) => {
    const i = Buffer.from(code).indexOf(Buffer.from(`${s}\0`, 'latin1'));
    if (i < 0) throw new Error(`code.bin に ${s} がない`);
    return BASE + i;
  };
  const ev = longestRun(words, va('msg\\evidence_name_00_jpn'), 40);
  const pr = longestRun(words, va('msg\\cast_name_00_jpn'), 32);
  return {
    evidence: [null, ...ev.map((w) => ({ name: words[w + 1]!, caption: words[w + 3]! }))],
    profiles: [
      null,
      ...pr.map((w) => ({ name: words[w + 1]!, caption: words[w + 3]!, age: words[w + 7]! })),
    ],
  };
}
