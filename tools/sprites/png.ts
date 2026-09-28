// PNG の読み書き（8 ビットの RGBA・RGB・グレー・パレット、インターレースなし）。
// 画像の検査を ImageMagick なしで、テスト（vitest）からも動かせるようにするための最小限の実装。
import { readFileSync, writeFileSync } from 'node:fs';
import { crc32, deflateSync, inflateSync } from 'node:zlib';

/** RGBA（1 点 4 バイト）の画像 */
export interface Rgba {
  w: number;
  h: number;
  data: Uint8Array;
}

export function blank(w: number, h: number): Rgba {
  return { w, h, data: new Uint8Array(w * h * 4) };
}

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a),
    pb = Math.abs(p - b),
    pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function decodePng(buf: Uint8Array): Rgba {
  if (!SIG.every((v, i) => buf[i] === v)) throw new Error('PNG ではありません');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let w = 0,
    h = 0,
    depth = 0,
    type = 0,
    interlace = 0;
  let palette: Uint8Array | undefined, trns: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  for (let p = 8; p < buf.length; ) {
    const len = view.getUint32(p);
    const name = String.fromCharCode(...buf.subarray(p + 4, p + 8));
    const body = buf.subarray(p + 8, p + 8 + len);
    if (name === 'IHDR') {
      w = view.getUint32(p + 8);
      h = view.getUint32(p + 12);
      depth = body[8]!;
      type = body[9]!;
      interlace = body[12]!;
    } else if (name === 'PLTE') palette = body;
    else if (name === 'tRNS') trns = body;
    else if (name === 'IDAT') idat.push(body);
    else if (name === 'IEND') break;
    p += 12 + len;
  }
  const ch = CHANNELS[type];
  if (!ch || interlace)
    throw new Error(`対応していない PNG です（種類 ${type}、インターレース ${interlace}）`);
  if (depth !== 8 && !(type === 3 && depth < 8))
    throw new Error(`対応していないビット数です: ${depth}`);
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = type === 3 ? 1 : ch; // フィルタの単位（バイト）
  const stride = Math.ceil((w * ch * (type === 3 ? depth : 8)) / 8);
  const px = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = px.subarray(y * stride, (y + 1) * stride);
    const prev = y ? px.subarray((y - 1) * stride, y * stride) : new Uint8Array(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp]! : 0,
        b = prev[i]!,
        c = i >= bpp ? prev[i - bpp]! : 0;
      const pred =
        f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? paeth(a, b, c) : 0;
      row[i] = (src[i]! + pred) & 255;
    }
  }
  const out = blank(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      if (type === 3) {
        const bit = x * depth;
        const idx = (px[y * stride + (bit >> 3)]! >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
        out.data[o] = palette?.[idx * 3] ?? 0;
        out.data[o + 1] = palette?.[idx * 3 + 1] ?? 0;
        out.data[o + 2] = palette?.[idx * 3 + 2] ?? 0;
        out.data[o + 3] = trns?.[idx] ?? 255;
        continue;
      }
      const s = y * stride + x * ch;
      const g = px[s]!;
      if (type === 0 || type === 4) {
        out.data.set([g, g, g, type === 4 ? px[s + 1]! : 255], o);
      } else {
        out.data.set([g, px[s + 1]!, px[s + 2]!, type === 6 ? px[s + 3]! : 255], o);
      }
    }
  }
  return out;
}

function chunk(name: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  out.set(new TextEncoder().encode(name), 4);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

/** RGBA の PNG に書き出す（フィルタなし） */
export function encodePng(img: Rgba): Uint8Array {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, img.w);
  v.setUint32(4, img.h);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const raw = new Uint8Array((img.w * 4 + 1) * img.h);
  for (let y = 0; y < img.h; y++) {
    raw.set(img.data.subarray(y * img.w * 4, (y + 1) * img.w * 4), y * (img.w * 4 + 1) + 1);
  }
  const parts = [
    new Uint8Array(SIG),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array()),
  ];
  return Buffer.concat(parts);
}

export const readPng = (path: string): Rgba => decodePng(readFileSync(path));
export const writePng = (path: string, img: Rgba): void => writeFileSync(path, encodePng(img));

/** 最近傍で n 倍に拡大する（確認用の画像） */
export function scaleUp(img: Rgba, n: number): Rgba {
  const out = blank(img.w * n, img.h * n);
  for (let y = 0; y < out.h; y++) {
    for (let x = 0; x < out.w; x++) {
      const s = (((y / n) | 0) * img.w + ((x / n) | 0)) * 4;
      out.data.set(img.data.subarray(s, s + 4), (y * out.w + x) * 4);
    }
  }
  return out;
}
