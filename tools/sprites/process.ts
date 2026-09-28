// 生成した元画像（1000px 前後）を、画面（256×192 ドット）用のドット絵に縮めてサンプルに取り込む。
//   bun tools/sprites/process.ts                  # すべて
//   bun tools/sprites/process.ts character        # 種類を指定
//   --out <フォルダ>  書き出し先（既定 apps/player/src/art。試すときは一時フォルダに）
//   --no-check        終わったあとの立ち絵のチェック（check.ts）をしない
// 人物は、口パクの絵を口のまわりだけ差し替える前のものも <書き出し先の横>/unpatched/character/ に残し、
// 最後に両方を check.ts で確かめる（差し替える前の結果は、モデルが口以外も描き直していないかの参考）。
// 縮小は面積平均（ぼかさずに色を混ぜる）、そのあと quantize.ts で DS の色の決まり（SPEC.md §2）に合わせて減色する:
//   15 ビット色・透明度は 0 か 255・ディザなし・中間色の孤立点を吸収。
//   人物は 1 人の全コマで 15 色のパレットを 1 枚共有し、輪郭の暗い色を必ず残す。
//   背景・机・証拠品も 1 枚 15 色（DS の法廷の背景・机・証拠品のアイコンの実測に合わせる）。
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ITEMS, type Item, type Kind, rawPath } from './manifest.ts';
import { patchMouth } from './mouth.ts';
import { decodePng, type Rgba, writePng } from './png.ts';
import { type QuantizeOptions, quantizeFrames } from './quantize.ts';
import { roleOf } from './spec.ts';

const ROOT = resolve(import.meta.dir, '../..');
const argv = process.argv.slice(2);
const outArg = argv.indexOf('--out');
const OUT = outArg >= 0 ? argv.splice(outArg, 2)[1]! : 'apps/player/src/art';
/** 口のまわりを差し替える前の口パクの絵（とベース）の置き場所 */
const UNPATCHED = outArg >= 0 ? `${OUT}/unpatched` : 'assets/generated/unpatched';
const kinds = argv.filter((a) => !a.startsWith('--')) as Kind[];
/**
 * 減色の設定。人物は 1 人 15 色（公式の 1 人の中央値）。背景・机・証拠品も、DS の法廷の背景（4bpp、15 色）・
 * 机（13〜14 色）・証拠品のアイコン（15 色）に合わせて 15 色にする（SPEC.md §2）
 */
const QUANT: Record<Kind, QuantizeOptions> = {
  character: { colors: 15, keepOutline: true },
  foreground: { colors: 15, keepOutline: true },
  evidence: { colors: 15, keepOutline: true },
  // 背景は輪郭がなく、広い面の色の段を優先する（点の数の重みをそのまま使う）
  background: { colors: 15, keepOutline: false, weightExp: 1 },
};
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

const out = (path: string) => {
  mkdirSync(resolve(ROOT, dirname(path)), { recursive: true });
  return path;
};

/** ImageMagick で縮めた結果を RGBA で受け取る（減色はこちらでする） */
const shrunk = (...args: string[]): Rgba => decodePng(magickBytes([...args, 'PNG32:-']));

/** 減色してから書き出す。同じパレットを共有するコマはまとめて渡す */
function quantizeTo(kind: Kind, frames: Rgba[], paths: string[], baseOf?: (number | undefined)[]) {
  const q = quantizeFrames(frames, QUANT[kind], baseOf).frames;
  q.forEach((img, i) => {
    writePng(resolve(ROOT, out(paths[i]!)), img);
  });
  return q;
}

/** その人物の元画像（ベースと、`<ID>-<名前>.png` の差分コマ・ポーズ）の名前。ベースが先頭 */
function characterFrames(item: Item): string[] {
  const dir = resolve(ROOT, dirname(rawPath(item)));
  const names = [...new Bun.Glob(`${item.id}-*.png`).scanSync(dir)]
    .map((f) => f.slice(0, -4))
    .filter((n) => roleOf(item.id, n) !== null)
    .sort();
  return [item.id, ...names];
}

function character(item: Item) {
  const names = characterFrames(item);
  const files = names.map((n) => rawPath(item, n.slice(item.id.length)));
  // すべてのコマがずれないよう、全コマを含む同じ範囲で切り抜く
  const boxes = files.map(trimBox);
  const x0 = Math.min(...boxes.map((b) => b.x)),
    y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)),
    y1 = Math.max(...boxes.map((b) => b.y + b.h));
  const crop = `${x1 - x0}x${Math.round((y1 - y0) * CHAR_KEEP)}+${x0}+${y0}`;
  const frames = files.map((f) =>
    shrunk(f, '-crop', crop, '+repage', '-filter', 'Box', '-resize', `${CHAR_MAX.w}x${CHAR_MAX.h}`),
  );
  // 1 人の全コマで 15 色のパレットを 1 枚共有する。パレットはベース（とポーズ）から作り、
  // 差分コマはそのベースで使った色だけで描く（差分コマにベースにない色が出ない）
  const roles = names.map((n) => roleOf(item.id, n)!);
  const baseOf = roles.map((r) =>
    r.role === 'talk' || r.role === 'blink' ? Math.max(0, names.indexOf(r.base)) : undefined,
  );
  const q = quantizeTo(
    'character',
    frames,
    names.map((n) => `${UNPATCHED}/character/${n}.png`),
    baseOf,
  );
  // 差分コマ（口パク・まばたき）は、変わったところがいちばん集まっている所だけを差分コマから取り、
  // ほかはベースの点をそのまま使う（範囲の外の変化を 0 にする）。差し替える前のものは UNPATCHED に残る
  names.forEach((n, i) => {
    const b = baseOf[i];
    const img = b === undefined ? q[i]! : { ...q[i]!, data: patchMouth(q[b]!, q[i]!) };
    writePng(resolve(ROOT, out(`${OUT}/character/${n}.png`)), img);
  });
}

function background(item: Item) {
  const img = shrunk(
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
  );
  quantizeTo('background', [img], [`${OUT}/background/${item.id}.png`]);
}

/** 机の天板の高さ（ドット）。DS 版と同じく、テキストウィンドウ（y 144〜）の上に天板が見えるようにする */
const DESK_TOP = 118;

function foreground(item: Item) {
  const tmp = `/tmp/gyakusai-fg-${item.id}.png`;
  const img = shrunk(
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
  );
  quantizeTo('foreground', [img], [tmp]);
  // 天板を DESK_TOP まで持ち上げる。持ち上げて空いた下の部分は、元の位置の机を下に敷いて埋める
  // （透明度が 0 か 255 なので、重ねても色は混ざらない）
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
    // 日時を書き込まない（同じ元画像からは同じファイルになるように）
    '-define',
    'png:exclude-chunks=date,time',
    `PNG32:${out(`${OUT}/foreground/${item.id}.png`)}`,
  );
}

function evidence(item: Item) {
  const b = trimBox(rawPath(item));
  const side = Math.max(b.w, b.h);
  const sizes = [64, 32];
  const frames = sizes.map((size) =>
    shrunk(
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
    ),
  );
  // 大小の 2 枚で 1 枚のパレットを共有する（DS のアイコンは 1 枚 15 色）
  quantizeTo(
    'evidence',
    frames,
    sizes.map((size) => `${OUT}/evidence/${item.id}-${size}.png`),
  );
}

const handlers = { character, background, foreground, evidence };
let done = 0;
for (const item of ITEMS) {
  if (kinds.length && !kinds.includes(item.kind)) continue;
  if (!existsSync(resolve(ROOT, rawPath(item)))) {
    console.log(`未生成のため飛ばします: ${rawPath(item)}`);
    continue;
  }
  handlers[item.kind](item);
  done++;
}
console.log(`加工しました: ${done} 件 → ${OUT}`);

// 立ち絵を SPEC.md の決まりで確かめる（失敗があれば終了コード 1）
if (!argv.includes('--no-check') && (!kinds.length || kinds.includes('character'))) {
  const check = (dir: string, out: string) =>
    Bun.spawnSync(['bun', resolve(import.meta.dir, 'check.ts'), '--dir', dir, '--out', out], {
      cwd: ROOT,
      stdout: 'inherit',
      stderr: 'inherit',
    }).exitCode;
  if (existsSync(resolve(ROOT, UNPATCHED, 'character'))) {
    console.log('\n==== 差し替える前の口パクの絵（参考。モデルが口以外を描き直していないか） ====');
    check(`${UNPATCHED}/character`, `${UNPATCHED}/check`);
  }
  console.log('\n==== 取り込んだ立ち絵 ====');
  process.exit(
    check(`${OUT}/character`, `${OUT === 'apps/player/src/art' ? 'assets/generated' : OUT}/check`),
  );
}
