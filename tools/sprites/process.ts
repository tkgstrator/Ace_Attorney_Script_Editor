// 生成した元画像（1000px 前後）を、画面（256×192 ドット）用のドット絵に縮めてサンプルに取り込む。
//   bun tools/sprites/process.ts
// 縮小は面積平均（ぼかさずに色を混ぜる）、そのあと色数を減らし、透明度を 0 か 255 にそろえる。
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ITEMS, type Item, rawPath } from './manifest.ts';
import { fixTalkFrame } from './mouth.ts';

const ROOT = resolve(import.meta.dir, '../..');
const OUT = 'apps/player/src/art';
const COLORS = '64';
/** 人物の立ち絵の最大の大きさ（ドット）。下端を画面の下端に合わせて描く（腰から下は机に隠れる） */
const CHAR_MAX = { w: 240, h: 180 };
/** 生成した人物は膝のあたりまで描かれるので、頭から太ももの上あたり（上からこの割合）までを使う */
const CHAR_KEEP = 0.62;

function magickBytes(args: string[], stdin?: Uint8Array): Uint8Array {
  const r = Bun.spawnSync(['magick', ...args], { cwd: ROOT, stdin });
  if (r.exitCode !== 0) throw new Error(`magick ${args.join(' ')}\n${r.stderr.toString()}`);
  return r.stdout;
}

function magick(...args: string[]): string {
  return new TextDecoder().decode(magickBytes(args)).trim();
}

/** 透明でない部分を囲む範囲 */
function trimBox(file: string) {
  const [w, h, x, y] = magick(
    file,
    '-alpha',
    'extract',
    '-threshold',
    '50%',
    '-format',
    '%@',
    'info:',
  )
    .match(/\d+/g)!
    .map(Number) as [number, number, number, number];
  return { x, y, w, h };
}

const pixelate = ['-channel', 'A', '-threshold', '50%', '+channel', '+dither', '-colors', COLORS];
const out = (path: string) => {
  mkdirSync(resolve(ROOT, dirname(path)), { recursive: true });
  return path;
};

function character(item: Item) {
  const base = rawPath(item),
    talk = rawPath(item, '-talk');
  const files = [base, ...(existsSync(resolve(ROOT, talk)) ? [talk] : [])];
  // 基本の絵と口パクの絵がずれないよう、両方を含む同じ範囲で切り抜く
  const boxes = files.map(trimBox);
  const x0 = Math.min(...boxes.map((b) => b.x)),
    y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)),
    y1 = Math.max(...boxes.map((b) => b.y + b.h));
  const crop = `${x1 - x0}x${Math.round((y1 - y0) * CHAR_KEEP)}+${x0}+${y0}`;
  const baseOut = out(`${OUT}/character/${item.id}.png`),
    talkOut = `${OUT}/character/${item.id}-talk.png`;
  const shrink = (file: string) => [
    file,
    '-crop',
    crop,
    '+repage',
    '-filter',
    'Box',
    '-resize',
    `${CHAR_MAX.w}x${CHAR_MAX.h}`,
  ];
  magick(...shrink(base), ...pixelate, baseOut);
  if (files.length < 2) return;
  // 口パクの絵は基本の絵と同じ色で減色し、口のまわり以外は基本の絵の点をそのまま使う
  magick(
    ...shrink(talk),
    '-channel',
    'A',
    '-threshold',
    '50%',
    '+channel',
    '+dither',
    '-remap',
    baseOut,
    talkOut,
  );
  fixTalkFrame(
    (...a) => magickBytes(a),
    baseOut,
    talkOut,
    (rgba, w, h, path) => magickBytes(['-size', `${w}x${h}`, '-depth', '8', 'rgba:-', path], rgba),
  );
}

function background(item: Item) {
  magick(
    rawPath(item),
    '-alpha',
    'off',
    '-filter',
    'Box',
    '-resize',
    '256x192^',
    '-gravity',
    'center',
    '-extent',
    '256x192',
    '+dither',
    '-colors',
    COLORS,
    out(`${OUT}/background/${item.id}.png`),
  );
}

/** 机の天板の高さ（ドット）。DS 版と同じく、テキストウィンドウ（y 144〜）の上に天板が見えるようにする */
const DESK_TOP = 118;

function foreground(item: Item) {
  const tmp = `/tmp/gyakusai-fg-${item.id}.png`;
  magick(
    rawPath(item),
    '-filter',
    'Box',
    '-resize',
    '256x192^',
    '-gravity',
    'south',
    '-background',
    'none',
    '-extent',
    '256x192',
    ...pixelate,
    tmp,
  );
  // 天板を DESK_TOP まで持ち上げる。持ち上げて空いた下の部分は、元の位置の机を下に敷いて埋める
  const shift = Math.max(0, trimBox(tmp).y - DESK_TOP);
  magick(
    '-size',
    '256x192',
    'xc:none',
    tmp,
    '-composite',
    tmp,
    '-geometry',
    `+0-${shift}`,
    '-composite',
    out(`${OUT}/foreground/${item.id}.png`),
  );
}

function evidence(item: Item) {
  const b = trimBox(rawPath(item));
  const side = Math.max(b.w, b.h);
  for (const size of [64, 32]) {
    magick(
      rawPath(item),
      '-crop',
      `${b.w}x${b.h}+${b.x}+${b.y}`,
      '+repage',
      '-background',
      'none',
      '-gravity',
      'center',
      '-extent',
      `${side}x${side}`,
      '-filter',
      'Box',
      '-resize',
      `${size - 2}x${size - 2}`,
      '-extent',
      `${size}x${size}`,
      ...pixelate,
      out(`${OUT}/evidence/${item.id}-${size}.png`),
    );
  }
}

const handlers = { character, background, foreground, evidence };
let done = 0;
for (const item of ITEMS) {
  if (!existsSync(resolve(ROOT, rawPath(item)))) {
    console.log(`未生成のため飛ばします: ${rawPath(item)}`);
    continue;
  }
  handlers[item.kind](item);
  done++;
}
console.log(`加工しました: ${done} 件 → ${OUT}`);
