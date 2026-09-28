// 編集の前後で、同じシーンの命令列の中の位置（pc）を対応させる（エディタのプレビューで、続きから遊ぶため）。
// 行を足したり消したりすると、分岐の飛び先の番号がずれるので、飛び先を除いた中身で命令を比べる。
// 前後の同じ部分を除いた「変わった所」より前はそのままの番号、後なら増減分ずらす。
// 変わった所の中なら、同じ中身の命令 → 同じ種類の命令 → 変わった所の中の近い命令、の順に選ぶ。
import type { Instr } from './types.ts';

/** 飛び先の番号を除いた、命令の中身（比べるためのキー） */
export function instrKey(ins: Instr): string {
  switch (ins.op) {
    case 'jump':
    case 'random':
      return ins.op;
    case 'jumpUnless':
      return JSON.stringify([ins.op, ins.cond]);
    case 'choice':
      return JSON.stringify([ins.op, ins.options.map((o) => [o.text, o.when ?? null])]);
    case 'demand':
      return JSON.stringify([
        ins.op,
        ins.prompt,
        ins.speaker ?? null,
        Object.keys(ins.options),
        Object.keys(ins.profiles ?? {}),
      ]);
    default:
      return JSON.stringify(ins);
  }
}

/** same: 同じ命令・同じ番号 / shifted: 同じ命令で番号がずれた / edited: 命令が変わった（編集した台詞など） */
export type PcMatch = { pc: number; how: 'same' | 'shifted' | 'edited' };

/** 前の命令列の pc に当たる、新しい命令列の pc（合わせられなければ null） */
export function mapPc(prev: readonly Instr[], next: readonly Instr[], pc: number): PcMatch | null {
  const old = prev[pc];
  if (!old) return null;
  if (prev === next) return { pc, how: 'same' };
  const a = prev.map(instrKey);
  const b = next.map(instrKey);
  const n = Math.min(a.length, b.length);
  let p = 0;
  while (p < n && a[p] === b[p]) p++;
  let q = 0;
  while (q < n - p && a[a.length - 1 - q] === b[b.length - 1 - q]) q++;
  if (pc < p) return { pc, how: 'same' };
  const delta = b.length - a.length;
  if (pc >= a.length - q) return { pc: pc + delta, how: delta === 0 ? 'same' : 'shifted' };
  // 変わった所の中: [p, a.length - q) → [p, b.length - q)
  const end = b.length - q;
  const guess = pc; // 変わった所の頭（p）からの距離を保った位置
  let best = -1;
  for (let i = p; i < end; i++) {
    if (b[i] === a[pc] && (best < 0 || Math.abs(i - guess) < Math.abs(best - guess))) best = i;
  }
  if (best >= 0) return { pc: best, how: best === pc ? 'same' : 'shifted' };
  if (guess < end && next[guess]!.op === old.op) return { pc: guess, how: 'edited' };
  // 近い同じ種類の命令
  for (let d = 1; d < end - p; d++) {
    for (const i of [guess - d, guess + d]) {
      if (i >= p && i < end && next[i]!.op === old.op) return { pc: i, how: 'edited' };
    }
  }
  // 同じ種類がなければ、変わった所の中の同じ位置（消えていれば、その後ろ）から続ける
  const at = Math.min(guess, end);
  return at < b.length ? { pc: at, how: 'edited' } : null;
}
