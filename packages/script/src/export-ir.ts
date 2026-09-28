// シナリオ YAML をコンパイルし、中間表現（IR、@gyakusai/core の CompiledScenario）を JSON で書き出す。
// Rust 版の整合性チェック（crates/aa-verify）は、この JSON を読んで調べる。
//   bun packages/script/src/export-ir.ts <シナリオ.yaml> > out.json
//   bun packages/script/src/export-ir.ts <シナリオ.yaml> -o out.json
import { readFileSync, writeFileSync } from 'node:fs';
import type { CompiledScenario } from '@gyakusai/core';
import { formatDiagnostic, loadScenario } from './load.ts';

/** YAML のテキストから IR を作る。コンパイルできなければ、診断を添えて例外 */
export function exportIr(source: string, file = ''): CompiledScenario {
  const { scenario, diagnostics } = loadScenario(source);
  if (!scenario) throw new Error(diagnostics.map((d) => formatDiagnostic(d, file)).join('\n'));
  return scenario;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  let out: string | undefined;
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-o') out = args[++i];
    else files.push(args[i]!);
  }
  if (files.length !== 1) {
    console.error('使い方: bun packages/script/src/export-ir.ts <シナリオ.yaml> [-o out.json]');
    process.exit(2);
  }
  const file = files[0]!;
  let json: string;
  try {
    json = JSON.stringify(exportIr(readFileSync(file, 'utf8'), file));
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
  if (out) writeFileSync(out, json);
  else process.stdout.write(json);
}
