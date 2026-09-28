// 生成した立ち絵のコマを、SPEC.md の決まりで確かめる。
//   bun tools/sprites/check.ts                    # manifest の人物すべて（apps/player/src/art/character）
//   bun tools/sprites/check.ts naruse torii       # 人物を指定
//   bun tools/sprites/check.ts --dir <フォルダ>    # 別の置き場所（切り分けたシートなど）
//   bun tools/sprites/check.ts --fix              # だめな差分コマを直したものも書き出す（元は残す）
//   --out <フォルダ>（既定 assets/generated/check）、--json <ファイル>、--tolerance <RGB の差>、--max-outside <点>
// 失敗が 1 つでもあれば終了コード 1。確かめる項目は SPEC.md の「チェッカー」の節。
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type FrameStats, frameStats, palette, type Rect } from './checks.ts';
import { compareFrames, type DiffResult, diffImage, fixFrame } from './diff.ts';
import { ITEMS } from './manifest.ts';
import { type Rgba, readPng, scaleUp, writePng } from './png.ts';
import { roleOf, SPEC } from './spec.ts';

const ROOT = resolve(import.meta.dirname, '../..');

interface FrameReport {
  file: string;
  role: string;
  base: string;
  stats: FrameStats;
  diff?: DiffResult;
  errors: string[];
  warnings: string[];
  diffImage?: string;
  fixed?: string;
}

interface CharReport {
  id: string;
  dir: string;
  colorsTotal: number;
  frames: FrameReport[];
  errors: string[];
  ok: boolean;
}

export interface Options {
  dir: string;
  out: string;
  fix: boolean;
  tolerance: number;
  maxOutside: number;
  masks?: Record<string, Rect[]>;
}

function statIssues(s: FrameStats, e: string[], w: string[]) {
  if (s.w > SPEC.screen.w || s.h > SPEC.screen.h)
    e.push(`キャンバスが画面より大きい (${s.w}×${s.h})`);
  else if (s.w !== SPEC.canvas.w || s.h !== SPEC.canvas.h)
    w.push(`キャンバスが推奨の ${SPEC.canvas.w}×${SPEC.canvas.h} ではない (${s.w}×${s.h})`);
  if (s.semiAlpha) e.push(`半透明の点が ${s.semiAlpha} 個`);
  if (s.colors > SPEC.maxColors) e.push(`色が ${s.colors} 色（上限 ${SPEC.maxColors}）`);
  if (s.aaSuspect > SPEC.aaSuspectMax)
    w.push(
      `アンチエイリアスの疑い ${(s.aaSuspect * 100).toFixed(1)}%（公式の p90 は ${SPEC.aaSuspectMax * 100}%）`,
    );
  if (s.outlineDark < SPEC.outlineDarkMin)
    w.push(`輪郭が暗い色でない（暗い 3 色が ${(s.outlineDark * 100).toFixed(0)}%）`);
  if (s.top !== null && (s.top < SPEC.top.min || s.top > SPEC.top.max))
    w.push(`頭の上端が y=${s.top}`);
  if (s.bottom !== null && s.bottom < SPEC.bottomMin)
    w.push(`体の下端が y=${s.bottom}（机に隠れる所まで描く）`);
  if (!s.opaque) e.push('不透明な点がない');
}

/** 推定した範囲を信じてよいか: 範囲の外の違いが範囲の中より少ない */
const reliable = (d: DiffResult) => d.maskSource !== 'estimated' || d.outside <= d.inside;

function diffIssues(d: DiffResult, o: Options, e: string[], w: string[]) {
  if (d.outside > o.maxOutside) {
    const b = d.outsideBox!;
    e.push(
      `変えてよい範囲の外で ${d.outside} 点の色が変わった（範囲 x${b[0]} y${b[1]} ${b[2]}×${b[3]}）`,
    );
  }
  if (d.shifted) e.push(`全体が (${d.shift.dx}, ${d.shift.dy}) ずれている`);
  if (d.newColorPx) e.push(`ベースにない色の点が ${d.newColorPx} 個`);
  if (d.changedFrac > SPEC.diff.maxChangedFrac)
    w.push(`範囲の中の変化が大きい（人物の ${(d.changedFrac * 100).toFixed(1)}%）`);
  if (!d.changed) w.push('ベースと同じ（差分がない）');
  if (d.maskSource === 'estimated')
    w.push('変えてよい範囲は推定（manifest の masks で決められる）');
  if (!reliable(d))
    w.push('違いが全体に散っていて、変えてよい範囲を推定できない（manifest の masks を書く）');
}

export function checkCharacter(id: string, o: Options): CharReport {
  const names = readdirSync(o.dir)
    .filter((f) => f.endsWith('.png') && !f.endsWith('.diff.png'))
    .map((f) => f.slice(0, -4))
    .filter((n) => roleOf(id, n))
    .sort();
  const imgs = new Map<string, Rgba>(names.map((n) => [n, readPng(`${o.dir}/${n}.png`)]));
  const frames: FrameReport[] = [];
  const all = new Set<number>();
  for (const name of names) {
    const img = imgs.get(name)!;
    const { role, base } = roleOf(id, name)!;
    const errors: string[] = [],
      warnings: string[] = [];
    const stats = frameStats(img);
    statIssues(stats, errors, warnings);
    for (const c of palette(img).keys()) all.add(c);
    const r: FrameReport = {
      file: `${name}.png`,
      role,
      base: `${base}.png`,
      stats,
      errors,
      warnings,
    };
    const b = imgs.get(base);
    if (role !== 'base' && !b) errors.push(`ベースのコマ ${base}.png がない`);
    else if (b && role !== 'base' && (b.w !== img.w || b.h !== img.h))
      errors.push(`ベース (${b.w}×${b.h}) と大きさが違う`);
    else if (b && (role === 'talk' || role === 'blink')) {
      const suffix = name.slice(id.length + 1);
      const d = compareFrames(b, img, role, o.masks?.[suffix] ?? o.masks?.[role], o.tolerance);
      r.diff = d;
      diffIssues(d, o, errors, warnings);
      mkdirSync(o.out, { recursive: true });
      r.diffImage = `${o.out}/${name}.diff.png`;
      writePng(r.diffImage, scaleUp(diffImage(b, img, d.masks, o.tolerance), 3));
      if (o.fix && errors.length && reliable(d)) {
        mkdirSync(`${o.out}/fixed`, { recursive: true });
        r.fixed = `${o.out}/fixed/${name}.png`;
        writePng(r.fixed, fixFrame(b, img, d));
        // 直したものの置き場所だけで確かめ直せるよう、ベースも並べる
        if (!existsSync(`${o.out}/fixed/${base}.png`)) writePng(`${o.out}/fixed/${base}.png`, b);
      }
    }
    frames.push(r);
  }
  const errors: string[] = [];
  if (!names.includes(id)) errors.push(`ベースのコマ ${id}.png がない`);
  if (all.size > SPEC.maxColorsTotal)
    errors.push(`全コマで ${all.size} 色（上限 ${SPEC.maxColorsTotal}）`);
  const ok = !errors.length && frames.every((f) => !f.errors.length);
  return { id, dir: o.dir, colorsTotal: all.size, frames, errors, ok };
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

export function printTable(reports: CharReport[]): void {
  const head = [
    'コマ',
    '種類',
    '大きさ',
    '色',
    '半透明',
    'AA疑い',
    '輪郭',
    '上〜下',
    '新色',
    '範囲外',
    'ずれ',
    '判定',
  ];
  const rows = reports.flatMap((c) =>
    c.frames.map((f) => [
      f.file,
      f.role,
      `${f.stats.w}×${f.stats.h}`,
      String(f.stats.colors),
      String(f.stats.semiAlpha),
      pct(f.stats.aaSuspect),
      pct(f.stats.outlineDark),
      `${f.stats.top ?? '-'}〜${f.stats.bottom ?? '-'}`,
      f.diff ? String(f.diff.newColorPx) : '-',
      f.diff ? `${f.diff.outside}` : '-',
      f.diff ? (f.diff.shifted ? `${f.diff.shift.dx},${f.diff.shift.dy}` : '0,0') : '-',
      f.errors.length ? '失敗' : f.warnings.length ? '注意' : 'OK',
    ]),
  );
  // 全角は 2 桁と数えて列をそろえる
  const width = (s: string) => [...s].reduce((n, ch) => n + (ch.charCodeAt(0) > 0xff ? 2 : 1), 0);
  const cols = head.map((h, i) => Math.max(width(h), ...rows.map((r) => width(r[i]!))));
  const line = (r: string[]) => r.map((s, i) => s + ' '.repeat(cols[i]! - width(s))).join('  ');
  console.log(line(head));
  for (const r of rows) console.log(line(r));
  for (const c of reports) {
    console.log(`\n■ ${c.id}: ${c.ok ? 'OK' : '失敗'}（全コマで ${c.colorsTotal} 色）`);
    for (const e of c.errors) console.log(`  ✗ ${e}`);
    for (const f of c.frames) {
      for (const e of f.errors) console.log(`  ✗ ${f.file}: ${e}`);
      for (const w of f.warnings) console.log(`  △ ${f.file}: ${w}`);
      if (f.diffImage) console.log(`    差分画像: ${f.diffImage.replace(`${ROOT}/`, '')}`);
      if (f.fixed) console.log(`    直したもの: ${f.fixed.replace(`${ROOT}/`, '')}`);
    }
  }
}

function main(argv: string[]) {
  const opt = (k: string) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv.splice(i, 2)[1] : undefined;
  };
  const dir = resolve(ROOT, opt('--dir') ?? 'apps/player/src/art/character');
  const out = resolve(ROOT, opt('--out') ?? 'assets/generated/check');
  const json = opt('--json');
  const tolerance = Number(opt('--tolerance') ?? SPEC.diff.tolerance);
  const maxOutside = Number(opt('--max-outside') ?? SPEC.diff.maxOutside);
  const fix = argv.includes('--fix');
  const ids = argv.filter((a) => !a.startsWith('--'));
  const chars = ITEMS.filter((i) => i.kind === 'character');
  const targets = ids.length
    ? ids
    : chars.map((c) => c.id).filter((id) => existsSync(`${dir}/${id}.png`));
  const reports = targets.map((id) =>
    checkCharacter(id, {
      dir,
      out,
      fix,
      tolerance,
      maxOutside,
      masks: chars.find((c) => c.id === id)?.masks,
    }),
  );
  printTable(reports);
  const ok = reports.every((r) => r.ok);
  mkdirSync(out, { recursive: true });
  const jsonPath = resolve(ROOT, json ?? `${out}/report.json`);
  writeFileSync(jsonPath, `${JSON.stringify({ ok, spec: SPEC, characters: reports }, null, 1)}\n`);
  console.log(
    `\n${ok ? 'すべて OK' : '失敗があります'}。JSON: ${jsonPath.replace(`${ROOT}/`, '')}`,
  );
  return ok;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)) ? 0 : 1);
