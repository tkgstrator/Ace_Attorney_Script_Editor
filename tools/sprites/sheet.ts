// スプライトシートで差分コマをまとめて生成するための、シートの作成と切り分け。
//   bun tools/sprites/sheet.ts make <人物> [--cells talk1,talk2,blink1,blink2] [--no-prefill] [--base <png>]
//     → assets/generated/sheets/<人物>.sheet.png（生成に渡すシート）と .sheet.json（並び）、指示文を表示
//   bun tools/sprites/sheet.ts cut <人物> <生成されたシート.png> [--no-snap] [--no-check]
//     → assets/generated/sheets/<人物>/ に <人物>.png（ベース）と <人物>-<枠>.png を書き、check.ts で確かめる
// 決まりは SPEC.md の「スプライトシート」の節。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { changedMask } from './checks.ts';
import { STYLE } from './manifest.ts';
import { readPng, writePng } from './png.ts';
import {
  cutSheet,
  drawSheet,
  planSheet,
  SHEET_DEFAULTS,
  type SheetLayout,
} from './sheet-layout.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const DIR = resolve(ROOT, 'assets/generated/sheets');

const hex = (c: number[]) =>
  `#${c
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;

/** シートに添える指示文（英語。SPEC.md の文例と同じ内容） */
export function sheetPrompt(l: SheetLayout, prefill: boolean): string {
  const what: Record<string, string> = {
    talk1: 'mouth half open (talking)',
    talk2: 'mouth wide open (talking)',
    blink1: 'eyes half closed (blinking)',
    blink2: 'eyes fully closed (blinking)',
  };
  const lines = l.cells
    .slice(1)
    .map((c, k) => `  - cell ${k + 2}: ${what[c] ?? what[`${c.replace(/\d+$/, '')}1`] ?? c}`);
  return [
    `EDIT the attached sprite sheet image. It is a grid of ${l.cols}×${l.rows} cells separated by ${hex(l.guide)} guide lines`,
    `(${l.gutter} px) on a flat ${hex(l.bg)} background. Keep the image size ${l.w}×${l.h}, the guide lines and the background exactly as they are.`,
    `Each pixel-art dot is a ${l.scale}×${l.scale} px square; keep this grid, no anti-aliasing, no new colors (reuse the colors of cell 1).`,
    'Cell 1 (top left) is the base frame: do not change it.',
    prefill
      ? 'The other cells contain copies of the base. In each of them change ONLY the listed facial part and leave every other dot identical:'
      : 'Draw the same character in the other cells, at exactly the same position and size as cell 1, changing ONLY:',
    ...lines,
    'Do not move, redraw, recolor or resize the body, hair, clothes or outline. Do not add text.',
    STYLE,
  ].join('\n');
}

function make(id: string, argv: string[], baseArg?: string, cellsArg?: string) {
  const basePath = resolve(ROOT, baseArg ?? `apps/player/src/art/character/${id}.png`);
  const cells = ['base', ...(cellsArg?.split(',') ?? SHEET_DEFAULTS.cells.slice(1))];
  const prefill = !argv.includes('--no-prefill');
  const base = readPng(basePath);
  const layout = planSheet(id, base, cells);
  mkdirSync(DIR, { recursive: true });
  writePng(`${DIR}/${id}.sheet.png`, drawSheet(layout, base, prefill));
  writeFileSync(
    `${DIR}/${id}.sheet.json`,
    `${JSON.stringify({ ...layout, basePath, prefill }, null, 2)}\n`,
  );
  console.log(
    `シート: assets/generated/sheets/${id}.sheet.png（${layout.w}×${layout.h}、${layout.cols}×${layout.rows} 枠、1 ドット = ${layout.scale}px）`,
  );
  console.log(`\n---- 指示文（シートを添えて画像生成に渡す）----\n${sheetPrompt(layout, prefill)}`);
}

function cut(id: string, file: string, argv: string[]) {
  const meta = JSON.parse(readFileSync(`${DIR}/${id}.sheet.json`, 'utf8')) as SheetLayout & {
    basePath: string;
  };
  const base = readPng(meta.basePath);
  const { frames, detected } = cutSheet(
    readPng(resolve(ROOT, file)),
    meta,
    base,
    !argv.includes('--no-snap'),
  );
  const out = `${DIR}/${id}`;
  mkdirSync(out, { recursive: true });
  writePng(`${out}/${id}.png`, base);
  console.log(`枠の検出: ${detected ? 'ガイドの線から' : '見つからないので並びの比から'}`);
  for (const f of frames) {
    // 最初の枠（生成し直されたベース）は、どれだけ描き直されたかの確認用に別の名前で残す
    const name = f.name === 'base' ? `sheet-base/${id}` : `${id}-${f.name}`;
    if (f.name === 'base') mkdirSync(`${out}/sheet-base`, { recursive: true });
    writePng(`${out}/${name}.png`, f.image);
    console.log(`  ${name}.png: 位置合わせ (${f.dx}, ${f.dy})、食い違い ${f.miss}`);
  }
  // 切り出しの誤差: 最初の枠（ベースを描き直したもの）とベースで色の違うドットの数。
  // ほかの枠も同じくらいの誤差を含むので、範囲の外の変化はこの 1.5 倍 + 20 まで許し、直したもの（--fix）を書き出す
  const sheetBase = frames.find((f) => f.name === 'base');
  const noise = sheetBase ? changedMask(base, sheetBase.image).reduce((a, v) => a + v, 0) : 0;
  const allowed = Math.ceil(noise * 1.5) + 20;
  console.log(
    `切り出しの誤差（ベースの枠）: ${noise} ドット → 範囲の外の変化は ${allowed} まで許す`,
  );
  writeFileSync(
    `${out}/cut.json`,
    `${JSON.stringify({ detected, noise, allowed, frames: frames.map(({ name, dx, dy, miss }) => ({ name, dx, dy, miss })) }, null, 2)}\n`,
  );
  if (argv.includes('--no-check')) return true;
  const args = [
    id,
    '--dir',
    out,
    '--out',
    `${out}/check`,
    '--max-outside',
    String(allowed),
    '--fix',
  ];
  const r = Bun.spawnSync(['bun', resolve(import.meta.dirname, 'check.ts'), ...args], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return r.exitCode === 0;
}

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const opt = (k: string) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv.splice(i, 2)[1] : undefined;
  };
  const baseArg = opt('--base'),
    cellsArg = opt('--cells');
  const [cmd, id, file] = argv.filter((a) => !a.startsWith('--'));
  if (cmd === 'make' && id) make(id, argv, baseArg, cellsArg);
  else if (cmd === 'cut' && id && file) process.exit(cut(id, file, argv) ? 0 : 1);
  else {
    console.error('使い方: bun tools/sprites/sheet.ts make <人物> | cut <人物> <シート.png>');
    process.exit(2);
  }
}
