// シナリオ YAML を検証する。書き方の検証の後、すべての遊び方を試す整合性チェック（詰み・到達しないもの）もする。
//   bun run check apps/player/cases/clocktower.yaml
//   bun run check --limit 5000000 大きな章.yaml   （調べる状態の数の上限。既定は DEFAULT_LIMIT）
//   bun run check --engine rust 大きな章.yaml     （整合性チェックを Rust 版 crates/aa-verify でする。編ごとに調べるので大きな章も終わる）
//   bun run check --light 章.yaml                 （Rust 版の軽いチェック: 状態を区別しない近似で、すぐ終わる）
import { readFileSync } from 'node:fs';
import { formatDiagnostic, loadScenario } from './load.ts';
import { hasRustBinary, rustBinary, verifyWithRust } from './rust-engine.ts';
import { DEFAULT_LIMIT, verifyScenario, type VerifyResult } from './verify.ts';

const args = process.argv.slice(2);
let limit = DEFAULT_LIMIT;
let engine = 'ts';
let light = false;
const files: string[] = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  const m = a.match(/^--limit(?:=(.*))?$/);
  const e = a.match(/^--engine(?:=(.*))?$/);
  if (m) limit = Number(m[1] ?? args[++i]);
  else if (e) engine = e[1] ?? args[++i] ?? '';
  else if (a === '--light') light = true;
  else files.push(a);
}
if (files.length === 0 || !Number.isFinite(limit) || limit <= 0 || !['ts', 'rust'].includes(engine)) {
  console.error('使い方: bun run check [--limit 状態の数] [--engine ts|rust] [--light] <シナリオ.yaml> ...');
  process.exit(2);
}
if ((engine === 'rust' || light) && !hasRustBinary()) {
  console.error(`Rust 版の整合性チェックがありません: ${rustBinary()}（cargo build --release -p aa-verify で作ってください）`);
  process.exit(2);
}
let failed = false;
for (const file of files) {
  const { scenario, diagnostics } = loadScenario(readFileSync(file, 'utf8'));
  for (const d of diagnostics) console.log(formatDiagnostic(d, file));
  if (scenario) {
    const scenes = Object.keys(scenario.scenes).length;
    const started = performance.now();
    const v: Pick<VerifyResult, 'findings' | 'states'> & { kind?: string } = engine === 'ts' && !light
      ? verifyScenario(scenario, { limit })
      : { states: 0, ...verifyWithRust(scenario, { limit, light }) };
    const sec = ((performance.now() - started) / 1000).toFixed(1);
    for (const f of v.findings as (typeof v.findings[number] & { kind?: string })[]) {
      const tag = f.kind ? `（軽いチェック・${f.kind}）` : '';
      console.log(`${file}:${f.scene ?? ''} ${f.severity === 'error' ? 'エラー' : '警告'}${tag}: ${f.message}`);
    }
    if (v.findings.some(f => f.severity === 'error')) failed = true;
    console.log(`${file}: ${v.findings.length === 0 ? 'OK' : '問題あり'}（シーン ${scenes}、証拠品 ${Object.keys(scenario.evidence).length}、`
      + `フラグ ${Object.keys(scenario.flags).length}、${light ? '軽いチェック（近似）' : `調べた状態 ${v.states}`}、${sec} 秒）`);
  } else {
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
