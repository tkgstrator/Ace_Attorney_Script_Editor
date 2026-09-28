// 差分テスト（深い所まで）: Rust 版の網羅的な探索で見つけた状態から選んだものについて、始まりからその状態までの
// エンジンの操作の列（aa-verify paths）を TS のエンジンで実行し、着いた状態（シーン・pc・mode・フラグ・証拠品・
// visited・seen）が Rust 版と一致するかを見る。乱数で遊ぶ playdiff.ts より、章の後半の編まで確かめられる。
//   bun crates/aa-verify/scripts/pathdiff.ts <IR.json> [個数=100]
import { readFileSync } from 'node:fs';
import {
  Engine,
  heldProfiles,
  type CompiledScenario,
  type GameState,
} from '../../../packages/core/src/index.ts';
import { prepare } from '../../../packages/script/src/verify-key.ts';

const [file, countArg] = process.argv.slice(2);
if (!file) {
  console.error('使い方: bun crates/aa-verify/scripts/pathdiff.ts <IR.json> [個数]');
  process.exit(2);
}
const bin = new URL('../../../target/release/aa-verify', import.meta.url).pathname;
const sc = prepare({
  ...(JSON.parse(readFileSync(file, 'utf8')) as CompiledScenario),
  maxLife: 1e9,
});
const out = Bun.spawnSync([bin, 'paths', file, String(Number(countArg ?? 100))]);
if (out.exitCode !== 0) {
  console.error(out.stderr.toString());
  process.exit(1);
}
const cases = out.stdout
  .toString()
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l) as { ops: string[]; state: unknown });

/** 操作の書き方の 1 つを行う（aa-verify の Act::describe と同じ書き方） */
function apply(e: Engine, a: string) {
  const rest = a.slice(1);
  switch (a[0]) {
    case 'a':
      e.advance();
      break;
    case 'p':
      e.press();
      break;
    case 'c':
      e.choose(Number(rest));
      break;
    case 'v':
      e.present(rest, 'evidence');
      break;
    case 'r':
      e.present(rest, 'profile');
      break;
    case 'e': {
      const [x, y] = rest.split(',').map(Number);
      e.examine(x!, y!);
      break;
    }
    case 'm':
      e.move(rest);
      break;
    case 't':
      e.talk(rest);
      break;
    case 'i': {
      const [id, n] = rest.split(':');
      e.inspect(id!);
      if (n !== undefined) e.choose(Number(n));
      break;
    }
    default:
      throw new Error(`未知の操作 ${a}`);
  }
}

let bad = 0,
  steps = 0;
for (const [i, c] of cases.entries()) {
  const e = new Engine(sc);
  try {
    for (const a of c.ops) apply(e, a);
  } catch (err) {
    bad++;
    console.log(`${i}: TS で実行できません: ${(err as Error).message}`);
    continue;
  }
  steps += c.ops.length;
  const s = e.state;
  const got = JSON.parse(
    JSON.stringify({
      scene: s.scene,
      pc: s.pc,
      mode: s.mode,
      flags: s.flags,
      evidence: s.evidence,
      profiles: heldProfiles(sc, s as GameState),
      recordLocked: s.stage.recordLocked,
      visited: [...s.visited].sort(),
      seen: [...s.seen].sort(),
    }),
  );
  if (JSON.stringify(got) !== JSON.stringify(c.state)) {
    bad++;
    console.log(`${i}: 食い違い（操作 ${c.ops.length} 個）`);
    console.log('  TS  :', JSON.stringify(got).slice(0, 500));
    console.log('  Rust:', JSON.stringify(c.state).slice(0, 500));
  }
}
console.log(`${file}: ${cases.length} 個の状態（操作 ${steps} 個）を比べ、食い違い ${bad} 個`);
process.exit(bad === 0 ? 0 : 1);
