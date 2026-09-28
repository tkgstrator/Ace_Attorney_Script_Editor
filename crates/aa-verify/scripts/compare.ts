// TS 版（packages/script の verifyScenario）と Rust 版（aa-verify --complete）の結果を比べる。
// 同じ IR に対して、報告（詰み・end に着けない・到達しないもの）の一覧が一致するかを見る。
// - Rust の --ts-exact（TS 版と同じ状態の見分け方）: 報告の並びと、状態の数まで一致するはず
// - Rust の既定（編ごと・証拠品も生きているものだけ）: 報告の集まりが一致するはず（状態の数は減る）
//   bun crates/aa-verify/scripts/compare.ts <シナリオ.yaml | IR.json> ... [--no-ts] [--limit N]
// --no-ts: TS 版を走らせず、Rust の 2 つのモードだけを比べる（TS 版では終わらない大きな章用）
import { readFileSync } from 'node:fs';
import type { CompiledScenario } from '../../../packages/core/src/index.ts';
import { loadScenario } from '../../../packages/script/src/load.ts';
import { verifyScenario } from '../../../packages/script/src/verify.ts';

const bin = new URL('../../../target/release/aa-verify', import.meta.url).pathname;
const args = process.argv.slice(2);
const noTs = args.includes('--no-ts');
const li = args.indexOf('--limit');
const limit = li >= 0 ? Number(args[li + 1]) : undefined;
const files = args.filter((a, i) => !a.startsWith('--') && (li < 0 || i !== li + 1));

interface Finding {
  severity: string;
  message: string;
  scene?: string;
}
interface Result {
  states: number;
  truncated: boolean;
  sec: number;
  findings: Finding[];
}

function ir(file: string): { json: string; scenario: CompiledScenario } {
  if (file.endsWith('.json')) {
    const json = readFileSync(file, 'utf8');
    return { json, scenario: JSON.parse(json) as CompiledScenario };
  }
  const { scenario, diagnostics } = loadScenario(readFileSync(file, 'utf8'));
  if (!scenario) throw new Error(diagnostics.map((d) => d.message).join('\n'));
  return { json: JSON.stringify(scenario), scenario };
}

function rust(json: string, flags: string[]): Result {
  const tmp = `${process.env.TMPDIR ?? '/tmp'}/aa-verify-compare-${process.pid}.json`;
  Bun.write(tmp, json);
  const out = Bun.spawnSync([
    bin,
    '--complete',
    '--json',
    ...(limit ? ['--limit', String(limit)] : []),
    ...flags,
    tmp,
  ]);
  const text = out.stdout.toString().trim();
  if (!text) throw new Error(out.stderr.toString());
  return JSON.parse(text) as Result;
}

const key = (f: Finding) => `${f.severity}\u0001${f.scene ?? ''}\u0001${f.message}`;
const sameSet = (a: Finding[], b: Finding[]) =>
  JSON.stringify(a.map(key).sort()) === JSON.stringify(b.map(key).sort());
const sameList = (a: Finding[], b: Finding[]) =>
  JSON.stringify(a.map(key)) === JSON.stringify(b.map(key));

function diff(label: string, a: Finding[], b: Finding[]) {
  const ka = new Set(a.map(key)),
    kb = new Set(b.map(key));
  for (const f of a) if (!kb.has(key(f))) console.log(`    ${label} にない: ${f.message}`);
  for (const f of b) if (!ka.has(key(f))) console.log(`    ${label} だけ: ${f.message}`);
}

let bad = false;
for (const file of files) {
  const { json, scenario } = ir(file);
  const exact = rust(json, ['--ts-exact']);
  const fast = rust(json, []);
  console.log(`${file}`);
  console.log(
    `  Rust（TS と同じ見分け方）: 状態 ${exact.states}、${exact.sec.toFixed(2)} 秒${exact.truncated ? '（打ち切り）' : ''}`,
  );
  console.log(
    `  Rust（既定）             : 状態 ${fast.states}、${fast.sec.toFixed(2)} 秒${fast.truncated ? '（打ち切り）' : ''}`,
  );
  if (!noTs) {
    const t = performance.now();
    const ts = verifyScenario(scenario, limit ? { limit } : {});
    console.log(
      `  TS                       : 状態 ${ts.states}、${((performance.now() - t) / 1000).toFixed(2)} 秒${ts.truncated ? '（打ち切り）' : ''}`,
    );
    const okExact = sameList(ts.findings, exact.findings) && ts.states === exact.states;
    const okFast = sameSet(ts.findings, fast.findings);
    console.log(
      `  TS と Rust（同じ見分け方）: ${okExact ? '一致（報告の並び・状態の数とも）' : '不一致'}`,
    );
    if (!okExact) diff('Rust（同じ見分け方）', ts.findings, exact.findings);
    console.log(`  TS と Rust（既定）       : ${okFast ? '一致（報告の集まり）' : '不一致'}`);
    if (!okFast) diff('Rust（既定）', ts.findings, fast.findings);
    bad ||= !okExact || !okFast;
  } else if (!exact.truncated) {
    const ok = sameSet(exact.findings, fast.findings);
    console.log(`  Rust の 2 つのモード     : ${ok ? '一致（報告の集まり）' : '不一致'}`);
    if (!ok) diff('Rust（既定）', exact.findings, fast.findings);
    bad ||= !ok;
  }
  console.log(
    `  報告 ${fast.findings.length} 件（エラー ${fast.findings.filter((f) => f.severity === 'error').length} 件）`,
  );
}
process.exit(bad ? 1 : 0);
