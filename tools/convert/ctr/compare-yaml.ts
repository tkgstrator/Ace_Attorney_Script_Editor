// Rust 版 aa-ctr の yaml 手順と TypeScript 版の変換結果を、YAML を読んだあとの JSON で比べる。
//
// 例:
//   bun tools/convert/ctr/compare-yaml.ts --episode 1 --rust /tmp/ep1.yaml
// TS 版の --out は一時ファイルを使う。--rust を省略すると /tmp/epN.yaml を読む。
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
}

function diff(a: unknown, b: unknown, path = '$'): string | null {
  if (Object.is(a, b)) return null;
  if (typeof a !== typeof b || a === null || b === null)
    return `${path}: ${JSON.stringify(a)} / ${JSON.stringify(b)}`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: length ${a.length} / ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = diff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    const ak = Object.keys(a as object);
    const bk = Object.keys(b as object);
    if (ak.join() !== bk.join()) return `${path}: keys ${ak.join(',')} / ${bk.join(',')}`;
    for (const k of ak) {
      const d = diff(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        `${path}.${k}`,
      );
      if (d) return d;
    }
    return null;
  }
  return `${path}: ${JSON.stringify(a)} / ${JSON.stringify(b)}`;
}

const args = process.argv.slice(2);
const ep = Number(arg(args, '--episode'));
if (!Number.isInteger(ep) || ep < 1 || ep > 5) throw new Error('--episode は 1〜5');
const root = join(import.meta.dir, '../../..');
const ts = join(tmpdir(), `aa6-ts-ep${ep}-${process.pid}.yaml`);
const rust = arg(args, '--rust') ?? join(tmpdir(), `ep${ep}.yaml`);
const cp = Bun.spawnSync(
  ['bun', 'tools/convert/ctr/index.ts', '--episode', String(ep), '--out', ts],
  { cwd: root },
);
if (cp.exitCode !== 0) throw new Error(new TextDecoder().decode(cp.stderr));
if (!existsSync(rust))
  throw new Error(
    `${rust} がありません（aa-ctr --only yaml --episode ${ep} --yaml-out ${rust} を先に実行）`,
  );
const a = parse(readFileSync(ts, 'utf8'));
const b = parse(readFileSync(rust, 'utf8'));
rmSync(ts);
const d = diff(a, b);
if (d) {
  console.error(`違い: ${d}`);
  process.exit(1);
}
console.log(`ep${ep}: YAML として同じ`);
