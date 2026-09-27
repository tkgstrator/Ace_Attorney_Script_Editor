// 取り込んだドット絵を、実際の画面と同じ順（背景 → 人物 → 手前）に重ねた確認用の画像を作る。
//   bun tools/sprites/preview.ts            # → assets/generated/preview/<立ち位置>.png（3 倍に拡大）
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '../..');
const ART = resolve(ROOT, 'apps/player/src/art');
const OUT = resolve(ROOT, 'assets/generated/preview');
/** 立ち位置ごとに、そこに立つ人物 */
const CAST: Record<string, string> = { defense: 'naruse', prosecution: 'himuro', witness: 'torii', judge: 'judge' };

mkdirSync(OUT, { recursive: true });
for (const [stand, who] of Object.entries(CAST)) {
  const layers = [
    `${ART}/background/${stand}.png`,
    `${ART}/character/${who}.png`,
    `${ART}/foreground/${stand}.png`,
  ];
  const args = ['-size', '256x192', 'xc:#1b1622'];
  for (const [i, file] of layers.entries()) {
    if (!existsSync(file)) continue;
    // 人物は画面の下端・中央に合わせる（実際の画面と同じ）
    args.push(file, '-gravity', i === 1 ? 'south' : 'northwest', '-composite');
  }
  args.push('-filter', 'point', '-resize', '300%', `${OUT}/${stand}.png`);
  const r = Bun.spawnSync(['magick', ...args]);
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  console.log(`${stand}: ${layers.filter(existsSync).map(f => f.replace(`${ART}/`, '')).join(' + ') || '（素材なし）'}`);
}
console.log(`書き出しました: ${OUT}`);
