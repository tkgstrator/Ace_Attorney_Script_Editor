// 差分テスト: 同じ操作の列を TS のエンジン（packages/core）と Rust 版（aa-verify replay）に与え、
// 各歩の後の状態（シーン・pc・mode・フラグ・証拠品・visited・seen）が一致するかを見る。
// 操作は乱数で選ぶ（種を固定するので、同じ引数なら同じ列）。
//   bun crates/aa-verify/scripts/playdiff.ts <IR.json> [遊ぶ回数=20] [1 回の歩数=400] [種=1]
import { readFileSync } from 'node:fs';
import {
  Engine,
  heldProfiles,
  type CompiledScenario,
  type GameState,
} from '../../../packages/core/src/index.ts';
import { prepare } from '../../../packages/script/src/verify-key.ts';

const [file, runsArg, stepsArg, seedArg] = process.argv.slice(2);
if (!file) {
  console.error('使い方: bun crates/aa-verify/scripts/playdiff.ts <IR.json> [回数] [歩数] [種]');
  process.exit(2);
}
const bin = new URL('../../../target/release/aa-verify', import.meta.url).pathname;
const sc = prepare({
  ...(JSON.parse(readFileSync(file, 'utf8')) as CompiledScenario),
  maxLife: 1e9,
});

/** 種を決められる乱数（mulberry32） */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function snapshot(s: Readonly<GameState>) {
  // 状態はこの後も書き換わるので、文字列にして写し取る
  return JSON.parse(
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
}

/** 今選べる操作を 1 つ乱数で選び、行う。操作の書き方を返す（終わりなら null） */
function play(e: Engine, rand: () => number): string | null {
  const b = e.beat;
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const opts: string[] = [];
  const held = e.state.evidence.map((id) => `v${id}`);
  const profiles = heldProfiles(sc, e.state as GameState).map((id) => `r${id}`);
  const inspects = 'inspect' in b && b.inspect ? b.inspect.map((id) => `i${id}`) : [];
  switch (b.kind) {
    case 'line':
    case 'card':
      opts.push('a', ...inspects);
      break;
    case 'shout':
    case 'banner':
    case 'fade':
    case 'wait':
      opts.push('a');
      break;
    case 'choice':
      b.options.forEach((_, i) => opts.push(`c${i}`));
      opts.push(...inspects);
      break;
    case 'demand':
      opts.push(...held, ...(b.profiles ? profiles : []), ...inspects);
      break;
    case 'statement':
      opts.push('a', ...inspects);
      if (b.cross) {
        if (b.canPress) opts.push('p');
        opts.push(...held);
      }
      break;
    case 'investigate':
      for (let i = 0; i < 4; i++)
        opts.push(`e${Math.floor(rand() * 256)},${Math.floor(rand() * 192)}`);
      opts.push(
        ...b.move.map((m) => `m${m.id}`),
        ...b.talk.map((t) => `t${t.id}`),
        ...(b.present ? [...held, ...profiles] : []),
        ...inspects,
      );
      break;
    case 'end':
    case 'gameover':
      return null;
  }
  let a = pick(opts);
  switch (a[0]) {
    case 'a':
      e.advance();
      break;
    case 'p':
      e.press();
      break;
    case 'c':
      e.choose(Number(a.slice(1)));
      break;
    case 'v':
      e.present(a.slice(1), 'evidence');
      break;
    case 'r':
      e.present(a.slice(1), 'profile');
      break;
    case 'e': {
      const [x, y] = a.slice(1).split(',').map(Number);
      e.examine(x!, y!);
      break;
    }
    case 'm':
      e.move(a.slice(1));
      break;
    case 't':
      e.talk(a.slice(1));
      break;
    case 'i': {
      e.inspect(a.slice(1));
      const nb = e.beat;
      // 詳しく調べるシーンは場所の選択肢から始まる。選ぶところまでを 1 つの操作にする
      if (nb.kind === 'choice') {
        const n = Math.floor(rand() * nb.options.length);
        e.choose(n);
        a += `:${n}`;
      }
      break;
    }
  }
  return a;
}

const runs = Number(runsArg ?? 20),
  steps = Number(stepsArg ?? 400);
let bad = 0,
  total = 0;
for (let r = 0; r < runs; r++) {
  const rand = rng(Number(seedArg ?? 1) * 1000 + r);
  const e = new Engine(sc);
  const acts: string[] = [];
  const want: unknown[] = [snapshot(e.state)];
  let error: string | null = null;
  for (let i = 0; i < steps; i++) {
    try {
      const a = play(e, rand);
      if (a === null) break;
      acts.push(a);
      want.push(snapshot(e.state));
    } catch (err) {
      error = (err as Error).message;
      break;
    }
  }
  const out = Bun.spawnSync([bin, 'replay', file], {
    stdin: new TextEncoder().encode(acts.join('\n') + '\n'),
  });
  const got = out.stdout
    .toString()
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l));
  total += want.length;
  let diff = -1;
  for (let i = 0; i < want.length; i++) {
    if (JSON.stringify(want[i]) !== JSON.stringify(got[i])) {
      diff = i;
      break;
    }
  }
  const gotError =
    got.length > want.length ? (got[want.length] as { error?: string }).error : undefined;
  if (diff < 0 && error !== null && gotError !== error) diff = want.length;
  if (diff >= 0) {
    bad++;
    console.log(`回 ${r}: 歩 ${diff} で食い違い（操作 ${acts[diff - 1] ?? '（始め）'}）`);
    console.log('  TS  :', JSON.stringify(want[diff] ?? { error }).slice(0, 600));
    console.log('  Rust:', JSON.stringify(got[diff]).slice(0, 600));
  }
}
console.log(`${file}: ${runs} 回・${total} 歩を比べ、食い違い ${bad} 回`);
process.exit(bad === 0 ? 0 : 1);
