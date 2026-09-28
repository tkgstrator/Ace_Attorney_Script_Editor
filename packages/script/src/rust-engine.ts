// 整合性チェックの Rust 版（crates/aa-verify）を呼ぶ。IR を一時ファイルに書き出して、バイナリに渡す。
// バイナリは、環境変数 AA_VERIFY_BIN か、リポジトリの target/release/aa-verify（cargo build --release -p aa-verify で作る）。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CompiledScenario } from '@gyakusai/core';
import type { Finding } from './verify.ts';

export const rustBinary = (): string =>
  process.env.AA_VERIFY_BIN ??
  fileURLToPath(new URL('../../../target/release/aa-verify', import.meta.url));

export const hasRustBinary = (): boolean => existsSync(rustBinary());

export interface RustVerifyResult {
  findings: (Finding & { kind?: string })[];
  /** 網羅的な探索のときだけ */
  states?: number;
  truncated?: boolean;
  sec: number;
  /** 編ごとの状態の数と時間（網羅的な探索のときだけ） */
  parts?: { id: string; states: number; sec: number }[];
}

/** light: 軽いチェック（既定のモード）。そうでなければ網羅的な探索（--complete） */
export function verifyWithRust(
  scenario: CompiledScenario,
  opts: { limit?: number; light?: boolean } = {},
): RustVerifyResult {
  const dir = mkdtempSync(join(tmpdir(), 'aa-verify-'));
  try {
    const file = join(dir, 'ir.json');
    writeFileSync(file, JSON.stringify(scenario));
    const args = [
      '--json',
      ...(opts.light ? [] : ['--complete']),
      ...(opts.limit ? ['--limit', String(opts.limit)] : []),
      file,
    ];
    let out: string;
    // 問題を見つけると終了コードが 1 になるので、そのときも出力を読む
    try {
      out = execFileSync(rustBinary(), args, { encoding: 'utf8', maxBuffer: 1 << 28 });
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message: string };
      if (!err.stdout) throw new Error(`aa-verify を実行できません: ${err.stderr || err.message}`);
      out = err.stdout;
    }
    return JSON.parse(out) as RustVerifyResult;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
